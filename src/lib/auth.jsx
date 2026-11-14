import { createContext, useContext, useMemo, useState } from 'react';
import * as api from './api';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [token, setTok] = useState(() => api.getToken());
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem('mirrorline.email');
    } catch {
      return null;
    }
  });

  const value = useMemo(
    () => ({
      token,
      email,

      async signIn(address, password) {
        const res = await api.login(address, password);

        api.setToken(res.token);
        api.setRefreshToken(res.refresh_token);

        const accountEmail = res.user?.email ?? address;
        try {
          localStorage.setItem('mirrorline.email', accountEmail);
        } catch {
          /* storage blocked */
        }

        setEmail(accountEmail);
        setTok(res.token);
      },

      signInDemo() {
        api.clearTokens();
        api.setToken('demo');
        setEmail('demo@mirrorline.app');
        setTok('demo');
      },

      async signOut() {
        try {
          if (api.getToken() && api.getToken() !== 'demo') {
            await api.logout();
          }
        } catch {
          // Always clear the local session, even if the server is unavailable.
        } finally {
          api.clearTokens();
          setTok(null);
          setEmail(null);
          try { localStorage.removeItem('mirrorline.email'); }
          catch { /* storage blocked */ }
        }
      },
    }),
    [token, email]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
