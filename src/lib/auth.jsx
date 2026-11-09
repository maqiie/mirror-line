import { createContext, useContext, useMemo, useState } from 'react';
import * as api from './api';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [token, setTok] = useState(() => api.getToken());
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('mirrorline.email'); } catch { return null; } });

  const value = useMemo(
    () => ({
      token,
      email,
      async signIn(address, password) {
        const res = await api.login(address, password);
        api.setToken(res.token);
        try { localStorage.setItem('mirrorline.email', res.user?.email ?? address); } catch { /* ignore */ }
        setEmail(res.user?.email ?? address);
        setTok(res.token);
      },
      signInDemo() {
        api.setToken('demo');
        setEmail('demo@mirrorline.app');
        setTok('demo');
      },
      signOut() {
        api.setToken(null);
        setTok(null);
      },
    }),
    [token, email]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
