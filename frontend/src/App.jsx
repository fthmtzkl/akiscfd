import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import NavBar        from "./components/NavBar";
import Dashboard     from "./pages/Dashboard";
import NewSimulation from "./pages/NewSimulation";
import ResultsPage   from "./pages/ResultsPage";
import LoginPage     from "./pages/LoginPage";
import RegisterPage  from "./pages/RegisterPage";
import PricingPage   from "./pages/PricingPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-slate-950">
          <Routes>
            {/* Auth pages — no navbar */}
            <Route path="/login"    element={<LoginPage />}    />
            <Route path="/register" element={<RegisterPage />} />

            {/* Main app — with navbar */}
            <Route path="/*" element={
              <>
                <NavBar />
                <Routes>
                  <Route path="/"                element={<Dashboard />}     />
                  <Route path="/new"             element={<NewSimulation />} />
                  <Route path="/results/:jobId"  element={<ResultsPage />}   />
                  <Route path="/pricing"         element={<PricingPage />}   />
                </Routes>
              </>
            } />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
