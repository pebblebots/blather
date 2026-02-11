import { createContext, useContext } from 'react';

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  isAgent: boolean;
}

export interface AppState {
  user: User | null;
  setUser: (u: User | null) => void;
}

export const AppContext = createContext<AppState>({
  user: null,
  setUser: () => {},
});

export const useApp = () => useContext(AppContext);
