import { useEffect, useState } from "react";
import {
  registerWithInvitation,
  signIn,
  signInWithGoogle,
  signOut,
  subscribeToAuth,
} from "@/lib/firebase/auth";
import type { SessionUser } from "@/lib/firebase/types";

export const useAuth = () => {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToAuth((nextUser) => {
      setUser(nextUser);
      setIsLoading(false);
    });

    return unsubscribe;
  }, []);

  return {
    user,
    isLoading,
    signIn,
    signInWithGoogle,
    registerWithInvitation,
    signOut,
  };
};
