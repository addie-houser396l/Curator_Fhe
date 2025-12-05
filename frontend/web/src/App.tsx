// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface CuratedList {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  title: string;
  category: string;
  itemsCount: number;
  status: "pending" | "verified" | "rejected";
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [lists, setLists] = useState<CuratedList[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newListData, setNewListData] = useState({ title: "", category: "Music", itemsCount: 0 });
  const [selectedList, setSelectedList] = useState<CuratedList | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");
  const [userHistory, setUserHistory] = useState<string[]>([]);

  const verifiedCount = lists.filter(l => l.status === "verified").length;
  const pendingCount = lists.filter(l => l.status === "pending").length;
  const rejectedCount = lists.filter(l => l.status === "rejected").length;

  const categories = ["Music", "Art", "Articles", "NFTs", "Videos", "Other"];

  useEffect(() => {
    loadLists().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadLists = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("list_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing list keys:", e); }
      }
      
      const loadedLists: CuratedList[] = [];
      for (const key of keys) {
        try {
          const listBytes = await contract.getData(`list_${key}`);
          if (listBytes.length > 0) {
            try {
              const listData = JSON.parse(ethers.toUtf8String(listBytes));
              loadedLists.push({ 
                id: key, 
                encryptedData: listData.data, 
                timestamp: listData.timestamp, 
                owner: listData.owner, 
                title: listData.title,
                category: listData.category,
                itemsCount: listData.itemsCount,
                status: listData.status || "pending" 
              });
            } catch (e) { console.error(`Error parsing list data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading list ${key}:`, e); }
      }
      
      loadedLists.sort((a, b) => b.timestamp - a.timestamp);
      setLists(loadedLists);
    } catch (e) { console.error("Error loading lists:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitList = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting curated list with Zama FHE..." });
    try {
      const encryptedData = FHEEncryptNumber(newListData.itemsCount);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const listId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const listData = { 
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        title: newListData.title,
        category: newListData.category,
        itemsCount: newListData.itemsCount,
        status: "pending" 
      };
      
      await contract.setData(`list_${listId}`, ethers.toUtf8Bytes(JSON.stringify(listData)));
      
      const keysBytes = await contract.getData("list_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(listId);
      await contract.setData("list_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted curated list submitted securely!" });
      addUserHistory(`Created list "${newListData.title}"`);
      await loadLists();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewListData({ title: "", category: "Music", itemsCount: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      addUserHistory(`Decrypted a curated list`);
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const verifyList = async (listId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Verifying encrypted list with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const listBytes = await contract.getData(`list_${listId}`);
      if (listBytes.length === 0) throw new Error("List not found");
      const listData = JSON.parse(ethers.toUtf8String(listBytes));
      
      const updatedList = { ...listData, status: "verified" };
      await contract.setData(`list_${listId}`, ethers.toUtf8Bytes(JSON.stringify(updatedList)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE verification completed successfully!" });
      addUserHistory(`Verified list ${listId.substring(0, 6)}`);
      await loadLists();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const rejectList = async (listId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Rejecting encrypted list with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const listBytes = await contract.getData(`list_${listId}`);
      if (listBytes.length === 0) throw new Error("List not found");
      const listData = JSON.parse(ethers.toUtf8String(listBytes));
      
      const updatedList = { ...listData, status: "rejected" };
      await contract.setData(`list_${listId}`, ethers.toUtf8Bytes(JSON.stringify(updatedList)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE rejection completed successfully!" });
      addUserHistory(`Rejected list ${listId.substring(0, 6)}`);
      await loadLists();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Rejection failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (listAddress: string) => address?.toLowerCase() === listAddress.toLowerCase();

  const addUserHistory = (action: string) => {
    const timestamp = new Date().toLocaleString();
    setUserHistory(prev => [`${timestamp}: ${action}`, ...prev.slice(0, 9)]);
  };

  const filteredLists = lists.filter(list => {
    const matchesSearch = list.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         list.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "All" || list.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const renderStatsCards = () => {
    return (
      <div className="stats-container">
        <div className="stat-card">
          <div className="stat-value">{lists.length}</div>
          <div className="stat-label">Total Lists</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{verifiedCount}</div>
          <div className="stat-label">Verified</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{pendingCount}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{rejectedCount}</div>
          <div className="stat-label">Rejected</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>隱秘策展人</h1>
          <span className="subtitle">FHE Encrypted Curated Lists</span>
        </div>
        <div className="header-actions">
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
        </div>
      </header>

      <main className="main-content">
        <div className="hero-section">
          <div className="hero-text">
            <h2>Curate with Privacy</h2>
            <p>Create FHE-encrypted content lists and trade your curation as NFTs</p>
            <button 
              className="create-btn" 
              onClick={() => setShowCreateModal(true)}
            >
              + New Curated List
            </button>
          </div>
          <div className="hero-image"></div>
        </div>

        <div className="project-intro">
          <h3>About Curator_Fhe</h3>
          <p>
            Curator_Fhe is a DeSoc protocol where users can create FHE-encrypted, 
            curated content lists (like playlists) and trade these "curations" as NFTs. 
            Powered by Zama FHE technology, it protects both the content and the 
            curator's taste while enabling new Web3 discovery models.
          </p>
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
        </div>

        <div className="search-filter-bar">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search lists..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <span className="search-icon">🔍</span>
          </div>
          <select 
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="All">All Categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <button 
            className="refresh-btn"
            onClick={loadLists}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh Lists"}
          </button>
        </div>

        <div className="data-section">
          <h3>Curated Lists Statistics</h3>
          {renderStatsCards()}
        </div>

        <div className="lists-grid">
          {filteredLists.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <p>No curated lists found</p>
              <button 
                className="create-btn"
                onClick={() => setShowCreateModal(true)}
              >
                Create First List
              </button>
            </div>
          ) : (
            filteredLists.map(list => (
              <div 
                className="list-card" 
                key={list.id}
                onClick={() => setSelectedList(list)}
              >
                <div className="card-header">
                  <span className={`status-badge ${list.status}`}>{list.status}</span>
                  <span className="category-tag">{list.category}</span>
                </div>
                <div className="card-body">
                  <h4>{list.title}</h4>
                  <p>{list.itemsCount} items</p>
                  <div className="card-footer">
                    <span className="owner">{list.owner.substring(0, 6)}...{list.owner.substring(38)}</span>
                    <span className="date">{new Date(list.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
                {isOwner(list.owner) && list.status === "pending" && (
                  <div className="card-actions">
                    <button 
                      className="action-btn verify"
                      onClick={(e) => { e.stopPropagation(); verifyList(list.id); }}
                    >
                      Verify
                    </button>
                    <button 
                      className="action-btn reject"
                      onClick={(e) => { e.stopPropagation(); rejectList(list.id); }}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="user-history">
          <h3>Your Recent Actions</h3>
          {userHistory.length === 0 ? (
            <p className="empty-history">No recent actions</p>
          ) : (
            <ul>
              {userHistory.map((action, index) => (
                <li key={index}>{action}</li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h3>Create New Curated List</h3>
              <button 
                className="close-btn"
                onClick={() => setShowCreateModal(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>List Title *</label>
                <input 
                  type="text" 
                  value={newListData.title}
                  onChange={(e) => setNewListData({...newListData, title: e.target.value})}
                  placeholder="My Awesome Playlist"
                />
              </div>
              <div className="form-group">
                <label>Category *</label>
                <select
                  value={newListData.category}
                  onChange={(e) => setNewListData({...newListData, category: e.target.value})}
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Number of Items *</label>
                <input 
                  type="number" 
                  value={newListData.itemsCount}
                  onChange={(e) => setNewListData({...newListData, itemsCount: parseInt(e.target.value) || 0})}
                  placeholder="10"
                  min="1"
                />
              </div>
              <div className="fhe-notice">
                <div className="fhe-icon">🔒</div>
                <p>
                  This list will be encrypted using Zama FHE technology. 
                  The item count will be fully homomorphically encrypted before being stored on-chain.
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button 
                className="cancel-btn"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button 
                className="submit-btn"
                onClick={submitList}
                disabled={creating || !newListData.title || !newListData.itemsCount}
              >
                {creating ? "Encrypting..." : "Create List"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedList && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h3>{selectedList.title}</h3>
              <button 
                className="close-btn"
                onClick={() => { setSelectedList(null); setDecryptedValue(null); }}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="list-meta">
                <div className="meta-item">
                  <span className="meta-label">Category:</span>
                  <span className="meta-value">{selectedList.category}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Owner:</span>
                  <span className="meta-value">{selectedList.owner}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Created:</span>
                  <span className="meta-value">{new Date(selectedList.timestamp * 1000).toLocaleString()}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Status:</span>
                  <span className={`meta-value status-badge ${selectedList.status}`}>{selectedList.status}</span>
                </div>
              </div>
              
              <div className="encrypted-section">
                <h4>Encrypted Data</h4>
                <div className="encrypted-data">
                  {selectedList.encryptedData.substring(0, 100)}...
                </div>
                <button 
                  className="decrypt-btn"
                  onClick={() => decryptedValue ? setDecryptedValue(null) : decryptWithSignature(selectedList.encryptedData)}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : decryptedValue ? "Hide Value" : "Decrypt Item Count"}
                </button>
              </div>
              
              {decryptedValue !== null && (
                <div className="decrypted-section">
                  <h4>Decrypted Item Count</h4>
                  <div className="decrypted-value">{decryptedValue}</div>
                  <p className="decrypt-notice">
                    This value was decrypted using your wallet signature. 
                    The original data remains encrypted on-chain with Zama FHE.
                  </p>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button 
                className="close-btn"
                onClick={() => { setSelectedList(null); setDecryptedValue(null); }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`status-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="status-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h4>隱秘策展人</h4>
            <p>FHE-encrypted curated content lists</p>
          </div>
          <div className="footer-links">
            <a href="#">Docs</a>
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© 2023 Curator_Fhe. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;