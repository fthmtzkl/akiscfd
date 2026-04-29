import React, { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Wind, Plus, Github, BookOpen, Zap, LogOut, User, ChevronDown } from "lucide-react";
import { useAuth } from "../context/AuthContext";

function UserMenu({ user, logout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const initials = user.full_name?.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-slate-800 transition-colors"
      >
        {/* Credit badge */}
        <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-600/20 border border-blue-500/30 rounded-full">
          <Zap className="w-3 h-3 text-blue-400" />
          <span className="text-blue-300 text-xs font-bold">{user.credits}</span>
        </div>

        {/* Avatar */}
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold">
          {initials}
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl shadow-black/50 py-1.5 z-50">
          <div className="px-4 py-3 border-b border-slate-800">
            <p className="text-white font-semibold text-sm truncate">{user.full_name}</p>
            <p className="text-slate-500 text-xs truncate">{user.email}</p>
          </div>
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-slate-400 text-xs">Credits remaining</span>
            <div className="flex items-center gap-1">
              <Zap className="w-3 h-3 text-blue-400" />
              <span className="text-white font-bold text-sm">{user.credits}</span>
            </div>
          </div>
          <div className="border-t border-slate-800 mt-1 pt-1">
            <Link
              to="/pricing"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <Zap className="w-3.5 h-3.5" /> Buy more credits
            </Link>
            <button
              onClick={() => { logout(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NavBar() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center group-hover:bg-blue-500 transition-colors">
            <Wind className="w-[18px] h-[18px] text-white" />
          </div>
          <span className="font-bold text-white text-lg tracking-tight">AkisCFD</span>
          <span className="hidden sm:block text-xs text-slate-500 font-normal mt-0.5">powered by OpenFOAM</span>
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-1">
          {[
            { to: "/",        label: "Dashboard" },
            { to: "/pricing", label: "Pricing" },
          ].map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                pathname === to
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              {label}
            </Link>
          ))}
          <a
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1.5"
          >
            <BookOpen className="w-3.5 h-3.5" /> API
          </a>
          <a
            href="https://github.com/fthmtzkl/akiscfd"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1.5"
          >
            <Github className="w-3.5 h-3.5" /> GitHub
          </a>
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Link
                to="/new"
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-blue-900/30"
              >
                <Plus className="w-4 h-4" />
                New Simulation
              </Link>
              <UserMenu user={user} logout={logout} />
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="px-4 py-2 text-slate-300 hover:text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors"
              >
                Sign In
              </Link>
              <Link
                to="/register"
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-blue-900/30"
              >
                Sign Up Free
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
