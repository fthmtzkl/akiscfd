import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Zap, Star, Building2, ArrowRight, Wind } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    price: 9,
    unit: "per simulation",
    icon: <Zap className="w-5 h-5" />,
    color: "blue",
    credits: 1,
    badge: null,
    features: [
      "1 CFD simulation",
      "Up to 1M mesh cells",
      "k-ω SST turbulence model",
      "Cd, Cl, Cs coefficients",
      "Pressure & velocity maps",
      "PDF report download",
    ],
    cta: "Buy Simulation",
  },
  {
    id: "standard",
    name: "Standard",
    price: 79,
    unit: "10 simulations",
    icon: <Star className="w-5 h-5" />,
    color: "violet",
    credits: 10,
    badge: "Most Popular",
    features: [
      "10 CFD simulations",
      "Up to 10M mesh cells",
      "All turbulence models",
      "Cd, Cl, Cs, Cf coefficients",
      "Drag & lift force (N)",
      "3D interactive pressure viewer",
      "PDF report + raw data export",
      "Priority queue",
    ],
    cta: "Get Standard",
  },
  {
    id: "pro",
    name: "Pro",
    price: 299,
    unit: "per month",
    icon: <Building2 className="w-5 h-5" />,
    color: "amber",
    credits: null,
    badge: null,
    features: [
      "Unlimited simulations",
      "Up to 100M mesh cells",
      "All turbulence models + custom",
      "Full aeroacoustic analysis",
      "API access (REST)",
      "Batch simulation runner",
      "Dedicated compute slot",
      "Slack/email support",
      "Custom NDA on request",
    ],
    cta: "Contact Sales",
  },
];

const ACCENT = {
  blue:   { badge: "bg-blue-600",   ring: "ring-blue-500/30",   btn: "bg-blue-600 hover:bg-blue-500",   iconBg: "bg-blue-600/20 text-blue-400",   border: "border-blue-500/40" },
  violet: { badge: "bg-violet-600", ring: "ring-violet-500/30", btn: "bg-violet-600 hover:bg-violet-500", iconBg: "bg-violet-600/20 text-violet-400", border: "border-violet-500/40" },
  amber:  { badge: "bg-amber-500",  ring: "ring-amber-500/30",  btn: "bg-amber-500 hover:bg-amber-400",  iconBg: "bg-amber-500/20 text-amber-400",   border: "border-amber-500/40" },
};

function WaitlistBanner() {
  const [email, setEmail] = useState("");
  const [done,  setDone]  = useState(false);

  const submit = (e) => {
    e.preventDefault();
    if (!email) return;
    const list = JSON.parse(localStorage.getItem("akiscfd_waitlist") || "[]");
    list.push({ email, ts: new Date().toISOString() });
    localStorage.setItem("akiscfd_waitlist", JSON.stringify(list));
    setDone(true);
  };

  return (
    <div className="max-w-xl mx-auto mt-16 p-6 bg-slate-800/60 border border-slate-700/60 rounded-2xl text-center">
      <p className="text-slate-300 font-semibold mb-1">Paid plans launching soon</p>
      <p className="text-slate-500 text-sm mb-5">
        Join the waitlist — get notified first and receive a 20% launch discount.
      </p>
      {done ? (
        <p className="text-green-400 font-medium text-sm">You're on the list! We'll be in touch.</p>
      ) : (
        <form onSubmit={submit} className="flex gap-2">
          <input
            type="email" required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="flex-1 px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
          />
          <button
            type="submit"
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-sm transition-colors whitespace-nowrap"
          >
            Join Waitlist
          </button>
        </form>
      )}
    </div>
  );
}

export default function PricingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleCta = (plan) => {
    if (plan.id === "pro") {
      window.location.href = "mailto:hello@akiscfd.com?subject=Pro Plan Inquiry";
      return;
    }
    navigate(user ? "/" : "/register");
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-950">

      {/* Hero */}
      <div className="bg-gradient-to-b from-slate-900 to-slate-950 border-b border-slate-800 py-16 px-4 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-600/20 border border-blue-500/30 text-blue-300 text-xs font-medium mb-6">
          <Wind className="w-3.5 h-3.5" />
          Simple, per-simulation pricing
        </div>
        <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight">
          Pay only for what you run
        </h1>
        <p className="text-slate-400 text-lg max-w-xl mx-auto leading-relaxed">
          No annual licenses. No HPC clusters. Just upload your 3D model,
          configure wind parameters, and get professional results.
        </p>
        {!user && (
          <Link
            to="/register"
            className="inline-flex items-center gap-2 mt-8 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-blue-900/30"
          >
            Start free — 3 simulations included <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </div>

      {/* Plans */}
      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map(plan => {
            const a = ACCENT[plan.color];
            const isPopular = plan.badge === "Most Popular";
            return (
              <div
                key={plan.id}
                className={[
                  "relative flex flex-col rounded-2xl border bg-slate-900 p-7 transition-all",
                  isPopular
                    ? `${a.border} ring-2 ${a.ring} shadow-xl`
                    : "border-slate-800 hover:border-slate-700",
                ].join(" ")}
              >
                {plan.badge && (
                  <div className={`absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold text-white ${a.badge}`}>
                    {plan.badge}
                  </div>
                )}

                {/* Header */}
                <div className="flex items-center gap-3 mb-5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${a.iconBg}`}>
                    {plan.icon}
                  </div>
                  <div>
                    <p className="font-bold text-white">{plan.name}</p>
                    {plan.credits && (
                      <p className="text-xs text-slate-500">{plan.credits} simulation{plan.credits > 1 ? "s" : ""}</p>
                    )}
                  </div>
                </div>

                {/* Price */}
                <div className="mb-6">
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-extrabold text-white">€{plan.price}</span>
                    <span className="text-slate-500 text-sm mb-1.5">/{plan.unit}</span>
                  </div>
                  {plan.id === "standard" && (
                    <p className="text-xs text-slate-500 mt-1">€7.90 per simulation</p>
                  )}
                </div>

                {/* Features */}
                <ul className="space-y-2.5 mb-8 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <button
                  onClick={() => handleCta(plan)}
                  className={`w-full py-3 rounded-xl font-semibold text-white text-sm transition-colors ${a.btn}`}
                >
                  {plan.cta}
                </button>
              </div>
            );
          })}
        </div>

        {/* Comparison note */}
        <div className="mt-10 p-5 bg-slate-900/60 border border-slate-800 rounded-2xl text-center">
          <p className="text-slate-400 text-sm">
            Compare to Ansys Fluent at <span className="text-white font-semibold">€50,000+/year</span> or AirShaper at{" "}
            <span className="text-white font-semibold">€52 per simulation</span>.{" "}
            AkisCFD is powered by the same open-source solver (OpenFOAM) at a fraction of the cost.
          </p>
        </div>

        <WaitlistBanner />

        {/* FAQ teaser */}
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-5 text-center">
          {[
            { q: "What file formats?", a: "STL, OBJ, and STEP. Max 100 MB per upload." },
            { q: "How long per simulation?", a: "10–90 min depending on mesh quality. Real-time progress bar included." },
            { q: "Credits expire?", a: "Never. Buy once, use whenever you need." },
          ].map(({ q, a }) => (
            <div key={q} className="p-5 bg-slate-900/40 border border-slate-800 rounded-2xl">
              <p className="text-white font-semibold text-sm mb-2">{q}</p>
              <p className="text-slate-400 text-xs leading-relaxed">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
