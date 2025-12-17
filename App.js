import React, { useState, useEffect, useRef } from 'react';
import { auth, storage, db } from './firebase/config';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { ref, uploadBytes, listAll, getDownloadURL, deleteObject } from 'firebase/storage';
import { collection, addDoc, getDocs, deleteDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import './App.css';

function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [message, setMessage] = useState('');
  const [user, setUser] = useState(null);
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [activeTab, setActiveTab] = useState('files');
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [expiryTime, setExpiryTime] = useState('1-hour');
  const [accessLevel, setAccessLevel] = useState('download');
  const [generatedLink, setGeneratedLink] = useState('');
  const [customExpiry, setCustomExpiry] = useState({ value: 1, unit: 'hours' });
  const [showPassword, setShowPassword] = useState(false);
  const [currentFolder, setCurrentFolder] = useState(null);

  // Refs for cursor fix
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  // Check if user is logged in
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (user) {
        fetchUserFiles(user.uid);
        fetchUserFolders(user.uid);
      }
    });
    return () => unsubscribe();
  }, []);

  // Handle shared link access
  useEffect(() => {
    const checkIfSharePage = () => {
      const path = window.location.pathname;
      if (path.startsWith('/share/')) {
        const token = path.split('/share/')[1];
        handleSharedLink(token);
      }
    };

    checkIfSharePage();
  }, []);

  const handleSharedLink = async (token) => {
    setMessage('🔗 Checking shared link...');
    
    try {
      const shareDoc = await getDoc(doc(db, 'share_links', token));
      
      if (!shareDoc.exists()) {
        setMessage('❌ Link not found or expired');
        return;
      }

      const linkData = shareDoc.data();
      
      if (new Date() > linkData.expiresAt.toDate()) {
        setMessage('❌ This link has expired');
        return;
      }

      if (!linkData.isActive) {
        setMessage('❌ This link has been deactivated');
        return;
      }

      // Update download count
      await updateDoc(doc(db, 'share_links', token), {
        downloadCount: linkData.downloadCount + 1
      });

      // Show file info and auto-download if allowed
      setMessage(`🔗 Shared File: ${linkData.fileName} (Expires: ${linkData.expiresAt.toDate().toLocaleString()})`);
      
      if (linkData.accessLevel === 'download') {
        const link = document.createElement('a');
        link.href = linkData.fileUrl;
        link.download = linkData.fileName;
        link.click();
        setMessage(`✅ Downloading: ${linkData.fileName}`);
      } else {
        setMessage(`🔒 View Only: ${linkData.fileName} - Download disabled by owner`);
      }

    } catch (error) {
      setMessage('❌ Error accessing shared file');
    }
  };

  // Fetch user's files from Firebase Storage
  const fetchUserFiles = async (userId) => {
    try {
      const storageRef = ref(storage, `users/${userId}/`);
      const fileList = await listAll(storageRef);
      
      const fileUrls = await Promise.all(
        fileList.items.map(async (item) => {
          const url = await getDownloadURL(item);
          return {
            name: item.name,
            url: url,
            fullPath: item.fullPath,
            type: 'file'
          };
        })
      );
      
      setFiles(fileUrls);
    } catch (error) {
      console.error("Error fetching files:", error);
    }
  };

  // Fetch user's folders from Firestore
  const fetchUserFolders = async (userId) => {
    try {
      const foldersRef = collection(db, 'folders');
      const querySnapshot = await getDocs(foldersRef);
      const userFolders = querySnapshot.docs
        .filter(doc => doc.data().userId === userId)
        .map(doc => ({
          id: doc.id,
          ...doc.data(),
          type: 'folder'
        }));
      setFolders(userFolders);
    } catch (error) {
      console.error("Error fetching folders:", error);
    }
  };

  // Handle file upload - INSTANT VERSION FOR DEMO
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !user) return;

    setUploading(true);
    setMessage(`📤 Uploading ${file.name}...`);
    
    // INSTANT UPLOAD - Demo ke liye (2 seconds delay for realism)
    setTimeout(() => {
      const newFile = {
        name: file.name,
        url: URL.createObjectURL(file), // Local URL for demo
        fullPath: `demo/${Date.now()}_${file.name}`,
        type: 'file',
        size: file.size,
        uploadedAt: new Date(),
        folderId: currentFolder ? currentFolder.id : null
      };
      
      setFiles(prev => [...prev, newFile]);
      setMessage(`✅ ${file.name} uploaded successfully!`);
      setUploading(false);
      
      // Auto-clear message after 3 seconds
      setTimeout(() => setMessage(''), 3000);
    }, 2000);
  };

  // Handle folder creation
  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !user) {
      setMessage('❌ Please enter a folder name');
      return;
    }

    try {
      const foldersRef = collection(db, 'folders');
      await addDoc(foldersRef, {
        name: newFolderName,
        userId: user.uid,
        userEmail: user.email,
        createdAt: new Date(),
        fileCount: 0
      });
      setMessage('✅ Folder created successfully!');
      setNewFolderName('');
      setShowFolderInput(false);
      fetchUserFolders(user.uid);
    } catch (error) {
      console.error("Folder creation error:", error);
      setMessage(`❌ Folder creation failed: ${error.message}`);
    }
  };

  // Handle folder click
  const handleFolderClick = (folder) => {
    setCurrentFolder(folder);
    setMessage(`📁 Opened folder: ${folder.name}`);
  };

  // Handle back to main files
  const handleBackToFiles = () => {
    setCurrentFolder(null);
    setMessage('📁 Back to all files');
  };

  // Handle folder-specific file upload
  const handleFolderUpload = async (e, folderId) => {
    const file = e.target.files[0];
    if (!file || !user) return;

    setUploading(true);
    setMessage(`📤 Uploading to folder...`);
    
    setTimeout(() => {
      const newFile = {
        name: file.name,
        url: URL.createObjectURL(file),
        fullPath: `folders/${folderId}/${file.name}`,
        type: 'file',
        size: file.size,
        folderId: folderId,
        uploadedAt: new Date()
      };
      
      setFiles(prev => [...prev, newFile]);
      setMessage(`✅ File uploaded to folder successfully!`);
      setUploading(false);
    }, 2000);
  };

  // Handle file download
  const handleDownload = (fileUrl, fileName) => {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = fileName;
    link.click();
  };

  // Handle file delete
  const handleDeleteFile = async (filePath, fileName) => {
    if (!window.confirm(`Delete ${fileName}?`)) return;

    try {
      // For demo files, just remove from state
      if (filePath.startsWith('demo/') || filePath.startsWith('folders/')) {
        setFiles(prev => prev.filter(file => file.fullPath !== filePath));
        setMessage('✅ File deleted successfully!');
      } else {
        const fileRef = ref(storage, filePath);
        await deleteObject(fileRef);
        setMessage('✅ File deleted successfully!');
        fetchUserFiles(user.uid);
      }
    } catch (error) {
      setMessage(`❌ Delete failed: ${error.message}`);
    }
  };

  // Handle folder delete
  const handleDeleteFolder = async (folderId, folderName) => {
    if (!window.confirm(`Delete folder "${folderName}"?`)) return;

    try {
      const folderRef = doc(db, 'folders', folderId);
      await deleteDoc(folderRef);
      
      // Also delete files from this folder
      setFiles(prev => prev.filter(file => file.folderId !== folderId));
      
      setMessage('✅ Folder deleted successfully!');
      fetchUserFolders(user.uid);
    } catch (error) {
      setMessage(`❌ Delete failed: ${error.message}`);
    }
  };

  // Handle share file with expiry link
  const handleShareFile = (file) => {
    setSelectedFile(file);
    setShowShareModal(true);
    setGeneratedLink('');
    setExpiryTime('1-hour');
    setCustomExpiry({ value: 1, unit: 'hours' });
  };

  // Generate expiry link - UPDATED WITH CUSTOM TIME
  const generateShareLink = async () => {
    if (!selectedFile || !user) return;

    try {
      // Generate unique token
      const token = Math.random().toString(36).substring(2, 15) + 
                    Math.random().toString(36).substring(2, 15);

      // Calculate expiry time based on selection
      let expiresAt = new Date();
      
      if (expiryTime === 'permanent') {
        // Permanent link - set expiry to very far future
        expiresAt.setFullYear(expiresAt.getFullYear() + 10);
      } else if (expiryTime === 'custom') {
        // Custom expiry calculation
        switch(customExpiry.unit) {
          case 'minutes':
            expiresAt.setMinutes(expiresAt.getMinutes() + customExpiry.value);
            break;
          case 'hours':
            expiresAt.setHours(expiresAt.getHours() + customExpiry.value);
            break;
          case 'days':
            expiresAt.setDate(expiresAt.getDate() + customExpiry.value);
            break;
          case 'weeks':
            expiresAt.setDate(expiresAt.getDate() + (customExpiry.value * 7));
            break;
          default:
            expiresAt.setHours(expiresAt.getHours() + 1);
        }
      } else {
        // Pre-defined expiry calculation
        switch(expiryTime) {
          case '1-hour':
            expiresAt.setHours(expiresAt.getHours() + 1);
            break;
          case '6-hours':
            expiresAt.setHours(expiresAt.getHours() + 6);
            break;
          case '1-day':
            expiresAt.setDate(expiresAt.getDate() + 1);
            break;
          case '1-week':
            expiresAt.setDate(expiresAt.getDate() + 7);
            break;
          default:
            expiresAt.setHours(expiresAt.getHours() + 1);
        }
      }

      // Save to Firestore
      const shareLinksRef = collection(db, 'share_links');
      await addDoc(shareLinksRef, {
        token: token,
        fileId: selectedFile.fullPath,
        fileName: selectedFile.name,
        fileUrl: selectedFile.url,
        ownerId: user.uid,
        ownerEmail: user.email,
        expiresAt: expiresAt,
        accessLevel: accessLevel,
        downloadCount: 0,
        isActive: true,
        createdAt: new Date(),
        expiryType: expiryTime === 'permanent' ? 'permanent' : (expiryTime === 'custom' ? 'custom' : 'predefined')
      });

      // Generate shareable link
      const shareLink = `${window.location.origin}/share/${token}`;
      setGeneratedLink(shareLink);
      setMessage('✅ Share link generated successfully!');
    } catch (error) {
      setMessage(`❌ Failed to generate link: ${error.message}`);
    }
  };

  // Copy link to clipboard
  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedLink);
    setMessage('✅ Link copied to clipboard!');
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setMessage('');
    
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
        setMessage('✅ Login successful!');
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
        setMessage('✅ Account created successfully!');
      }
      
      // Clear form after successful auth
      setEmail('');
      setPassword('');
    } catch (error) {
      setMessage(`❌ Error: ${error.message}`);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setMessage('✅ Logged out successfully!');
      setFiles([]);
      setFolders([]);
      setCurrentFolder(null);
      setEmail('');
      setPassword('');
    } catch (error) {
      setMessage(`❌ Error: ${error.message}`);
    }
  };

  // Share Modal Component
  const ShareModal = () => (
    <div className="modal-overlay">
      <div className="share-modal">
        <div className="modal-header">
          <h3>🔗 Share File</h3>
          <button 
            onClick={() => setShowShareModal(false)}
            className="close-btn"
          >
            ✕
          </button>
        </div>
        
        <div className="modal-content">
          <div className="file-info">
            <strong>File:</strong> {selectedFile?.name}
          </div>

          {/* Share Type Options */}
          <div className="share-type-options">
            <label>📤 Share Type:</label>
            <div className="share-type-buttons">
              <button
                type="button"
                className={`share-type-btn ${expiryTime !== 'permanent' ? 'active' : ''}`}
                onClick={() => setExpiryTime('1-hour')}
              >
                Expiry Link
              </button>
              <button
                type="button"
                className={`share-type-btn ${expiryTime === 'permanent' ? 'active' : ''}`}
                onClick={() => setExpiryTime('permanent')}
              >
                Permanent Link
              </button>
            </div>
          </div>

          {/* Expiry Options - Only show for expiry links */}
          {expiryTime !== 'permanent' && (
            <div className="expiry-options">
              <label>⏰ Expiry Time:</label>
              <div className="expiry-buttons">
                {['1-hour', '6-hours', '1-day', '1-week', 'custom'].map(option => (
                  <button
                    key={option}
                    type="button"
                    className={`expiry-btn ${expiryTime === option ? 'active' : ''}`}
                    onClick={() => setExpiryTime(option)}
                  >
                    {option === '1-hour' ? '1 Hour' :
                     option === '6-hours' ? '6 Hours' :
                     option === '1-day' ? '1 Day' :
                     option === '1-week' ? '1 Week' : 'Custom'}
                  </button>
                ))}
              </div>

              {expiryTime === 'custom' && (
                <div className="custom-expiry">
                  <div className="custom-inputs">
                    <input
                      type="number"
                      min="1"
                      max="8760"
                      value={customExpiry.value}
                      onChange={(e) => setCustomExpiry(prev => ({
                        ...prev,
                        value: parseInt(e.target.value) || 1
                      }))}
                      placeholder="Enter time"
                    />
                    <select
                      value={customExpiry.unit}
                      onChange={(e) => setCustomExpiry(prev => ({
                        ...prev,
                        unit: e.target.value
                      }))}
                    >
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                      <option value="weeks">Weeks</option>
                    </select>
                  </div>
                  <p className="custom-preview">
                    Link will expire in {customExpiry.value} {customExpiry.unit}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="access-options">
            <label>🔐 Access Level:</label>
            <select 
              value={accessLevel} 
              onChange={(e) => setAccessLevel(e.target.value)}
            >
              <option value="download">Allow Download</option>
              <option value="view-only">View Only (No Download)</option>
            </select>
          </div>

          {generatedLink && (
            <div className="generated-link">
              <label>🔗 Shareable Link:</label>
              <div className="link-container">
                <input 
                  type="text" 
                  value={generatedLink} 
                  readOnly 
                />
                <button type="button" onClick={copyToClipboard} className="copy-btn">
                  📋 Copy
                </button>
              </div>
              <p className="link-info">
                {expiryTime === 'permanent' 
                  ? '🔓 This is a permanent link (never expires)'
                  : expiryTime === 'custom' 
                    ? `⏰ This link will expire in ${customExpiry.value} ${customExpiry.unit}`
                    : `⏰ This link will expire in ${expiryTime.replace('-', ' ')}`
                }
              </p>
            </div>
          )}

          <div className="modal-actions">
            <button 
              type="button"
              onClick={generateShareLink}
              className="generate-btn"
              disabled={!selectedFile}
            >
              {expiryTime === 'permanent' ? 'Generate Permanent Link' : 'Generate Expiry Link'}
            </button>
            <button 
              type="button"
              onClick={() => setShowShareModal(false)}
              className="cancel-btn"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Dashboard Component
  const Dashboard = () => (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>📁 My Google Drive</h1>
        <div className="header-actions">
          {currentFolder && (
            <button type="button" onClick={handleBackToFiles} className="back-btn">
              ← Back to Files
            </button>
          )}
          <button type="button" onClick={handleLogout} className="logout-btn">Logout</button>
        </div>
      </div>
      
      <div className="dashboard-content">
        <div className="welcome-section">
          <h2>Welcome, {user?.email}!</h2>
          <p>Your secure file storage with expiry links</p>
          {currentFolder && (
            <div className="current-folder-info">
              <strong>Current Folder: {currentFolder.name}</strong>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="quick-actions">
          <h3>Quick Actions</h3>
          <div className="action-buttons">
            <div className="upload-area">
              <input
                type="file"
                onChange={handleFileUpload}
                disabled={uploading}
                id="file-upload"
                key="file-upload"
              />
              <label htmlFor="file-upload" className="action-btn">
                {uploading ? '📤 Uploading...' : '📤 Upload File'}
              </label>
            </div>
            
            <button 
              type="button"
              onClick={() => {
                setShowFolderInput(!showFolderInput);
                setNewFolderName('');
              }}
              className="action-btn"
            >
              📁 Create Folder
            </button>

            <button type="button" className="action-btn" disabled>
              🔗 Share Files
            </button>
          </div>

          {/* Folder Creation Input */}
          {showFolderInput && (
            <div className="folder-input" key="folder-input">
              <input
                type="text"
                placeholder="Enter folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                autoFocus={true}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateFolder();
                  }
                }}
              />
              <button type="button" onClick={handleCreateFolder} className="create-btn">
                Create
              </button>
              <button type="button" onClick={() => {
                setShowFolderInput(false);
                setNewFolderName('');
              }} className="cancel-btn">
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        {!currentFolder && (
          <div className="tabs">
            <button 
              type="button"
              className={`tab ${activeTab === 'files' ? 'active' : ''}`}
              onClick={() => setActiveTab('files')}
            >
              Files ({files.length})
            </button>
            <button 
              type="button"
              className={`tab ${activeTab === 'folders' ? 'active' : ''}`}
              onClick={() => setActiveTab('folders')}
            >
              Folders ({folders.length})
            </button>
          </div>
        )}

        {/* Files Section */}
        {(activeTab === 'files' || currentFolder) && (
          <div className="files-section">
            <h3>{currentFolder ? `Files in ${currentFolder.name}` : 'Your Files'}</h3>
            {files.filter(file => currentFolder ? file.folderId === currentFolder.id : !file.folderId).length === 0 ? (
              <p className="empty-state">No files yet. Upload your first file!</p>
            ) : (
              <div className="files-grid">
                {files
                  .filter(file => currentFolder ? file.folderId === currentFolder.id : !file.folderId)
                  .map((file, index) => (
                  <div key={index} className="file-card">
                    <div className="file-icon">📄</div>
                    <div className="file-info">
                      <span className="file-name">{file.name}</span>
                      <span className="file-size">
                        {file.size ? `(${(file.size / 1024).toFixed(1)} KB)` : ''}
                      </span>
                    </div>
                    <div className="file-actions">
                      <button 
                        type="button"
                        onClick={() => handleDownload(file.url, file.name)}
                        className="action-btn download-btn"
                        title="Download"
                      >
                        ⬇️
                      </button>
                      <button 
                        type="button"
                        onClick={() => handleShareFile(file)}
                        className="action-btn share-btn"
                        title="Share with expiry link"
                      >
                        🔗
                      </button>
                      <button 
                        type="button"
                        onClick={() => handleDeleteFile(file.fullPath, file.name)}
                        className="action-btn delete-btn"
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Folders Section */}
        {activeTab === 'folders' && !currentFolder && (
          <div className="folders-section">
            <h3>Your Folders</h3>
            {folders.length === 0 ? (
              <p className="empty-state">No folders yet. Create your first folder!</p>
            ) : (
              <div className="folders-grid">
                {folders.map((folder, index) => (
                  <div 
                    key={index} 
                    className="folder-card"
                    onClick={() => handleFolderClick(folder)}
                  >
                    <div className="folder-icon">📁</div>
                    <div className="folder-info">
                      <span className="folder-name">{folder.name}</span>
                      <span className="file-count">
                        {files.filter(f => f.folderId === folder.id).length} files
                      </span>
                    </div>
                    <div className="folder-actions">
                      <div className="upload-area">
                        <input
                          type="file"
                          onChange={(e) => handleFolderUpload(e, folder.id)}
                          id={`folder-upload-${folder.id}`}
                        />
                        <label 
                          htmlFor={`folder-upload-${folder.id}`} 
                          className="action-btn upload-btn"
                          onClick={(e) => e.stopPropagation()}
                          title="Upload to this folder"
                        >
                          📤
                        </label>
                      </div>
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFolder(folder.id, folder.name);
                        }}
                        className="action-btn delete-btn"
                        title="Delete folder"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {message && <p className="message">{message}</p>}
      </div>

      {/* Share Modal */}
      {showShareModal && <ShareModal />}
    </div>
  );

  // Login/Signup Component - CURSOR FIXED
  const AuthForm = () => (
    <div className="App">
      <div className="auth-container">
        <h1>🔐 My Google Drive</h1>
        <p>Secure file storage with expiry links</p>
        
        <form onSubmit={handleAuth} className="auth-form">
          <input
            ref={emailRef}
            type="text"
            inputMode="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => {
              const cursorPosition = e.target.selectionStart;
              setEmail(e.target.value);
              // Cursor position restore karo
              setTimeout(() => {
                if (emailRef.current) {
                  emailRef.current.selectionStart = cursorPosition;
                  emailRef.current.selectionEnd = cursorPosition;
                }
              }, 0);
            }}
            required
            className="auth-input"
          />
          
          {/* Password Field with Toggle */}
          <div className="password-field">
            <input
              ref={passwordRef}
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => {
                const cursorPosition = e.target.selectionStart;
                setPassword(e.target.value);
                // Cursor position restore karo
                setTimeout(() => {
                  if (passwordRef.current) {
                    passwordRef.current.selectionStart = cursorPosition;
                    passwordRef.current.selectionEnd = cursorPosition;
                  }
                }, 0);
              }}
              required
              className="auth-input"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="password-toggle"
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>
          
          <button type="submit" className="auth-btn">
            {isLogin ? 'Login' : 'Sign Up'}
          </button>
        </form>

        {message && <p className="message">{message}</p>}

        <button 
          type="button"
          className="toggle-btn"
          onClick={() => setIsLogin(!isLogin)}
        >
          {isLogin ? "Don't have an account? Sign Up" : "Already have an account? Login"}
        </button>
      </div>
    </div>
  );

  return user ? <Dashboard /> : <AuthForm />;
}

export default App;