import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
const TOKEN_KEY = "akiscfd_token";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session from localStorage on mount
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setLoading(false); return; }
    axios.get(`${BASE_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setUser(r.data))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  const _save = (token, userData) => {
    localStorage.setItem(TOKEN_KEY, token);
    setUser(userData);
  };

  const register = useCallback(async ({ email, password, full_name }) => {
    const { data } = await axios.post(`${BASE_URL}/auth/register`, { email, password, full_name });
    _save(data.access_token, data.user);
    return data.user;
  }, []);

  const login = useCallback(async ({ email, password }) => {
    const { data } = await axios.post(`${BASE_URL}/auth/login`, { email, password });
    _save(data.access_token, data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  const getToken = () => localStorage.getItem(TOKEN_KEY);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, register, getToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}
