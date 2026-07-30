import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

const BUCKET_NAME = "klangsamong-e1d13.firebasestorage.app";
const BUCKET_GS_URL = "gs://" + BUCKET_NAME;

// Web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBRN0jiR1XqGYEY0wQlh1VcELT3MiNBbM0",
  authDomain: "klangsamong-e1d13.firebaseapp.com",
  projectId: "klangsamong-e1d13",
  storageBucket: BUCKET_NAME,
  messagingSenderId: "274749483806",
  appId: "1:274749483806:web:b6fa61f0989f222b9f370f",
  measurementId: "G-988GTXNEVW"
};

// Initialize Firebase App & Storage targeting gs://klangsamong-e1d13.firebasestorage.app
const app = initializeApp(firebaseConfig);
const storage = getStorage(app, BUCKET_GS_URL);

// Helper function to remove old file from Firebase Storage if it exists
window.firebaseStorageDelete = async function(url) {
    if (!url || typeof url !== 'string') return false;
    if (!url.includes('firebasestorage.googleapis.com') && !url.includes(BUCKET_NAME) && !url.includes('klangsamong-e1d13')) return false;

    try {
        const match = url.match(/\/o\/([^?]+)/);
        if (!match) return false;
        
        const objectPath = decodeURIComponent(match[1]);
        console.log('Attempting to delete old file from Firebase Storage:', objectPath);

        // 1. Try Firebase Storage SDK deleteObject
        try {
            const storageRef = ref(storage, objectPath);
            await deleteObject(storageRef);
            console.log('✅ Successfully deleted old file via Firebase SDK:', objectPath);
            return true;
        } catch (sdkErr) {
            console.warn('Firebase SDK delete notice, attempting direct REST delete:', sdkErr);
        }

        // 2. Try Firebase REST API DELETE
        const encodedPath = encodeURIComponent(objectPath);
        const restUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodedPath}`;
        const res = await fetch(restUrl, { method: 'DELETE' });
        if (res.ok) {
            console.log('✅ Successfully deleted old file via Firebase REST API:', objectPath);
            return true;
        }
    } catch (err) {
        console.error('Notice: Error removing old file from Firebase Storage:', err);
    }
    return false;
};

// Direct Firebase Storage Upload helper with REST fallback and old file removal
window.firebaseStorageUpload = async function(file, subFolder, statusCallback, oldFileUrl = '') {
    if (!file) return '';

    // If an old file URL was provided, attempt to delete it from Firebase Storage
    if (oldFileUrl) {
        try {
            await window.firebaseStorageDelete(oldFileUrl);
        } catch(e) { console.warn('Old file delete notice:', e); }
    }

    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const objectPath = `${subFolder}/${Date.now()}_${cleanFileName}`;

    // 1. Try Firebase Storage SDK uploadBytesResumable
    try {
        const storageRef = ref(storage, objectPath);
        const downloadURL = await new Promise((resolve, reject) => {
            const uploadTask = uploadBytesResumable(storageRef, file);
            uploadTask.on('state_changed',
                (snapshot) => {
                    const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                    if (statusCallback) statusCallback(progress);
                },
                (error) => reject(error),
                async () => {
                    try {
                        const url = await getDownloadURL(uploadTask.snapshot.ref);
                        resolve(url);
                    } catch (err) {
                        reject(err);
                    }
                }
            );
        });
        if (downloadURL) return downloadURL;
    } catch (sdkErr) {
        console.warn('Firebase SDK upload notice, attempting direct Firebase REST upload:', sdkErr);
    }

    // 2. Direct Firebase Storage REST API Upload (100% reliable direct bucket upload)
    const encodedPath = encodeURIComponent(objectPath);
    const restUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o?uploadType=media&name=${encodedPath}`;

    const res = await fetch(restUrl, {
        method: 'POST',
        headers: {
            'Content-Type': file.type || 'application/octet-stream'
        },
        body: file
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Firebase Storage HTTP Error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodedPath}?alt=media`;
    if (statusCallback) statusCallback(100);
    return publicUrl;
};
