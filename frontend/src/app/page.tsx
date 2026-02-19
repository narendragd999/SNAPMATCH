"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import CountUp from "react-countup";
import { useState } from "react";
import { PlayCircle } from "lucide-react";
import { APP_CONFIG } from "@/config/app";

export default function HomePage() {
  const [openVideo, setOpenVideo] = useState(false);

  return (
    <div className="relative font-sans text-gray-800 bg-white overflow-hidden">

      {/* Animated Background Blobs */}
      <div className="absolute top-0 left-0 w-[600px] h-[600px] bg-purple-300 rounded-full blur-[120px] opacity-30 animate-pulse" />
      <div className="absolute top-40 right-0 w-[500px] h-[500px] bg-blue-300 rounded-full blur-[120px] opacity-30 animate-pulse" />

      {/* ================= NAVBAR ================= */}
      <header className="fixed top-0 w-full bg-white/70 backdrop-blur-md shadow-sm z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center px-6 py-4">
          <h1 className="text-xl font-bold text-purple-700">
            SnapFine AI Finder
          </h1>

          <nav className="hidden md:flex gap-8 items-center text-sm">
            <a href="#features">Features</a>
            <a href="#how">How It Works</a>
            <a href="#pricing">Pricing</a>

            <Link
              href="/login?mode=login"
              className="px-5 py-2 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 transition"
            >
              Organizer Login
            </Link>
          </nav>
        </div>
      </header>

      {/* ================= HERO ================= */}
      <section className="min-h-screen flex items-center bg-gradient-to-r from-purple-700 to-blue-600 text-white pt-24 relative z-10">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-2 gap-16 items-center">

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <h2 className="text-5xl md:text-6xl font-bold leading-tight">
              Find Every Photo of You
              <span className="block mt-2">Instantly.</span>
            </h2>

            <p className="mt-8 text-lg opacity-90">
              AI-powered face recognition and clustering built for
              modern events and professional organizers.
            </p>

            <div className="mt-10 flex gap-4 flex-wrap">

              <Link
                href="/public-search"
                className="px-8 py-4 bg-white text-blue-600 font-semibold rounded-xl shadow-lg hover:scale-105 transition"
              >
                📸 Find My Photos
              </Link>

              <Link
                href="/login?mode=register"
                className="px-8 py-4 border border-white rounded-xl hover:bg-white/10 transition"
              >
                🎯 I’m an Event Organizer
              </Link>

              <button
                onClick={() => setOpenVideo(true)}
                className="flex items-center gap-2 px-6 py-4"
              >
                <PlayCircle /> Watch Demo
              </button>
            </div>
          </motion.div>

          {/* Floating UI Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            className="bg-white rounded-3xl shadow-2xl p-6 text-gray-800"
          >
            <div className="text-sm font-semibold mb-4">
              🔍 Live Search Results
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[...Array(9)].map((_, i) => (
                <div
                  key={i}
                  className="bg-gray-200 rounded-xl h-28 hover:scale-105 transition"
                />
              ))}
            </div>
          </motion.div>

        </div>
      </section>

      {/* ================= STATS ================= */}
      <section className="py-20 bg-white text-center">
        <div className="max-w-6xl mx-auto grid md:grid-cols-4 gap-10">

          {[
            ["Events", 12000],
            ["Photos Indexed", 2000000],
            ["Faces Recognized", 350000],
            ["Searches", 85000],
          ].map(([label, value], i) => (
            <div key={i}>
              <h3 className="text-4xl font-bold text-purple-600">
                <CountUp end={Number(value)} duration={2} />
              </h3>
              <p className="text-gray-500 mt-2">{label}</p>
            </div>
          ))}

        </div>
      </section>

      {/* ================= FEATURES ================= */}
      <section id="features" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold mb-16">
            Enterprise-Level AI Features
          </h2>

          <div className="grid md:grid-cols-4 gap-10">
            {[
              "Selfie AI Search",
              "Smart Clustering",
              "Social Graph",
              "Bulk ZIP Downloads",
            ].map((feature, i) => (
              <motion.div
                key={i}
                whileHover={{ scale: 1.05 }}
                className="bg-white rounded-2xl shadow-lg p-8"
              >
                <div className="h-12 w-12 bg-gradient-to-r from-purple-500 to-blue-500 rounded-lg mx-auto mb-6" />
                <h3 className="font-semibold">{feature}</h3>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= TESTIMONIALS ================= */}
      <section className="py-24 bg-white text-center">
        <h2 className="text-4xl font-bold mb-12">
          Loved by Professionals
        </h2>

        <div className="max-w-4xl mx-auto bg-gray-50 rounded-3xl shadow p-10">
          <p className="text-lg italic text-gray-600">
            “SnapFine reduced our event delivery time by 70%.
            Clients love the instant selfie search!”
          </p>
          <div className="mt-6 font-semibold">
            – EventPro Studios
          </div>
        </div>
      </section>

      {/* ================= PRICING ================= */}
      <section id="pricing" className="py-24 bg-gray-50 text-center">
        <h2 className="text-4xl font-bold mb-16">
          Pricing for Professionals
        </h2>

        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-10">
          <div className="bg-white p-10 rounded-3xl shadow">
            <h3 className="text-xl font-semibold mb-4">Free</h3>
            <p className="text-4xl font-bold mb-6">₹0</p>
          </div>

          <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-10 rounded-3xl shadow-2xl scale-105">
            <h3 className="text-xl font-semibold mb-4">Pro</h3>
            <p className="text-4xl font-bold mb-6">₹499/mo</p>
          </div>

          <div className="bg-white p-10 rounded-3xl shadow">
            <h3 className="text-xl font-semibold mb-4">Enterprise</h3>
            <p className="text-4xl font-bold mb-6">Custom</p>
          </div>
        </div>
      </section>

      {/* Sticky CTA */}
      <div className="fixed bottom-0 w-full bg-purple-600 text-white text-center py-3">
        Start your AI-powered event today →
      </div>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-10 text-center text-sm">
        © {new Date().getFullYear()}  {APP_CONFIG.name}
      </footer>

    </div>
  );
}
