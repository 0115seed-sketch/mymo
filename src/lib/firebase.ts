import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyDyj-3sT2KOjE10qF8Hvn5amqQcb8WSRAo',
  authDomain: 'mymo-3562c.firebaseapp.com',
  projectId: 'mymo-3562c',
  storageBucket: 'mymo-3562c.firebasestorage.app',
  messagingSenderId: '213283163583',
  appId: '1:213283163583:web:e1deea6f6148168c02a50a',
  measurementId: 'G-H1EM68PYV5',
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()
