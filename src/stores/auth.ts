import { createSignal } from 'solid-js'
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth'
import { auth, googleProvider } from '../lib/firebase'

const [user, setUser] = createSignal<User | null>(null)
const [authLoading, setAuthLoading] = createSignal(true)

// Firebase 인증 상태 변화 감지 (앱 시작 시 1회 구독)
onAuthStateChanged(auth, (firebaseUser) => {
  setUser(firebaseUser)
  setAuthLoading(false)
})

export const loginWithGoogle = () => signInWithPopup(auth, googleProvider)

export const logout = () => signOut(auth)

export { user, authLoading }
