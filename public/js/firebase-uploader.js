import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

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

// Direct Firebase Storage Upload helper with REST fallback
window.firebaseStorageUpload = async function(file, subFolder, statusCallback) {
    if (!file) return '';
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
