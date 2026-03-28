"use client";

import Head from "next/head";
import Link from "next/link";
import { motion, useScroll, useTransform, AnimatePresence, useMotionValue, useSpring } from "framer-motion";
import CountUp from "react-countup";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera, Search, Users, Download, Shield, Zap,
  ChevronRight, Star, Check, Menu, X, ArrowRight,
  Image, Clock, Award, Globe, Mail, Phone, Calculator, ShieldCheck,
  Sparkles, Play, Pause, Volume2, VolumeX, ExternalLink, Lock,
  CreditCard, Server, Heart, MessageCircle, Send, Loader2, CheckCircle,
  TrendingUp, Eye, MousePointer, Clock4, BadgeCheck, PartyPopper,
} from "lucide-react";
import { APP_CONFIG } from "@/config/app";

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES & INTERFACES
   ═══════════════════════════════════════════════════════════════════════════ */
interface Stat {
  value: number;
  suffix: string;
  label: string;
  decimals?: number;
  trend?: number; // percentage change
}

interface Feature {
  icon: React.ElementType;
  title: string;
  desc: string;
  tag: string;
  gradient?: string;
}

interface Testimonial {
  id: string;
  name: string;
  role: string;
  company?: string;
  text: string;
  rating: number;
  avatar?: string;
  verified?: boolean;
}

interface FAQ {
  q: string;
  a: string;
  category?: string;
}

interface PlatformStats {
  eventsHosted: number;
  photosIndexed: number;
  facesRecognised: number;
  matchAccuracy: number;
  activeUsers: number;
  photosToday: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANIMATION VARIANTS
   ═══════════════════════════════════════════════════════════════════════════ */
const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  show: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] },
  }),
};

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };

const scaleIn = {
  hidden: { opacity: 0, scale: 0.95 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

const slideInLeft = {
  hidden: { opacity: 0, x: -40 },
  show: { opacity: 1, x: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

const slideInRight = {
  hidden: { opacity: 0, x: 40 },
  show: { opacity: 1, x: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

const float = {
  initial: { y: 0 },
  animate: {
    y: [-8, 8, -8],
    transition: { duration: 4, repeat: Infinity, ease: "easeInOut" }
  },
};

const pulse = {
  initial: { scale: 1, opacity: 0.5 },
  animate: {
    scale: [1, 1.2, 1],
    opacity: [0.5, 0.8, 0.5],
    transition: { duration: 2, repeat: Infinity, ease: "easeInOut" }
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   STATIC DATA
   ═══════════════════════════════════════════════════════════════════════════ */
const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how" },
  { label: "Pricing", href: "/pricing", highlight: true },
  { label: "FAQ", href: "#faq" },
];

const FEATURES: Feature[] = [
  {
    icon: Search,
    title: "Selfie Face Search",
    desc: "Guests upload a single selfie and instantly receive every photo of themselves from the entire event — no manual browsing required.",
    tag: "Core",
    gradient: "from-violet-500 to-purple-500",
  },
  {
    icon: Users,
    title: "Smart Face Clustering",
    desc: "AI automatically groups photos by person using InsightFace embeddings + FAISS indexing. Zero manual tagging required.",
    tag: "AI",
    gradient: "from-cyan-500 to-teal-500",
  },
  {
    icon: Download,
    title: "Bulk ZIP Download",
    desc: "Guests download their complete photo collection in one click. Organisers export any cluster or the entire event instantly.",
    tag: "Popular",
    gradient: "from-emerald-500 to-green-500",
  },
  {
    icon: Shield,
    title: "PIN-Protected Events",
    desc: "Every event gets a private access link with optional PIN protection. Only invited guests can search and download photos.",
    tag: "Security",
    gradient: "from-amber-500 to-orange-500",
  },
  {
    icon: Zap,
    title: "Fast Bulk Upload",
    desc: "Upload thousands of photos at once via presigned MinIO URLs. Direct browser-to-storage transfers with real-time progress.",
    tag: "Performance",
    gradient: "from-pink-500 to-rose-500",
  },
  {
    icon: Globe,
    title: "Public Guest Portal",
    desc: "Share a single link with all event attendees. No app download, no account needed — just a selfie to find their photos.",
    tag: "UX",
    gradient: "from-blue-500 to-indigo-500",
  },
  {
    icon: Image,
    title: "Scene & Object AI",
    desc: "Places365 + YOLO automatically tag scene types and objects, enabling rich filtering: 'outdoor portraits', 'stage shots', etc.",
    tag: "AI",
    gradient: "from-fuchsia-500 to-purple-500",
  },
  {
    icon: Award,
    title: "Custom Watermarking",
    desc: "Protect your work by applying custom watermarks to delivered photos. Toggle per event, adjust opacity and position.",
    tag: "Pro",
    gradient: "from-yellow-500 to-amber-500",
  },
];

const HOW_STEPS = [
  {
    step: "01",
    title: "Upload Event Photos",
    desc: "Drag & drop or select thousands of photos. Our bulk uploader handles them in parallel batches with live progress tracking.",
    icon: Camera,
  },
  {
    step: "02",
    title: "AI Processes & Clusters",
    desc: "InsightFace detects and embeds every face. FAISS builds a searchable index. 1,000 photos clustered in under 4 minutes.",
    icon: Sparkles,
  },
  {
    step: "03",
    title: "Share Guest Link",
    desc: "Send one link to all attendees. They take a selfie, our AI finds every photo of them across the entire event instantly.",
    icon: Globe,
  },
  {
    step: "04",
    title: "Download & Deliver",
    desc: "Guests download their photos in one ZIP. Professional delivery done — no WhatsApp bulk-sending, no manual sorting.",
    icon: Download,
  },
];

const PLANS = [
  {
    name: "Free",
    price: "₹0",
    period: "",
    badge: "",
    desc: "Try SnapFind risk-free on your first event",
    features: [
      { text: "1 event included", included: true },
      { text: "Up to 500 photos", included: true },
      { text: "AI face search for guests", included: true },
      { text: "Individual photo download", included: true },
      { text: "Guest portal with share link", included: true },
      { text: "PIN protection", included: true },
      { text: "7-day cloud storage", included: true },
      { text: "Bulk ZIP download", included: false },
      { text: "Watermarking", included: false },
      { text: "AI scene & object tags", included: false },
      { text: "Guest upload portal", included: false },
    ],
    cta: "Start Free",
    href: "/login?mode=register",
    highlight: false,
  },
  {
    name: "Pay Per Event",
    price: "Custom",
    period: "",
    badge: "MOST POPULAR",
    desc: "Build exactly what your event needs — pay only for what you use",
    features: [
      { text: "Custom photo count (slider)", included: true },
      { text: "Custom storage duration", included: true },
      { text: "Guest upload portal (optional)", included: true },
      { text: "Bulk ZIP download", included: true },
      { text: "AI face search + clustering", included: true },
      { text: "AI scene & object tags", included: true },
      { text: "Custom watermarking", included: true },
      { text: "PIN protection", included: true },
      { text: "Custom guest upload limit", included: true },
      { text: "Extended cloud storage", included: true },
    ],
    cta: "Configure Your Event",
    href: "/pricing",
    highlight: true,
  },
];

const PRICING_FACTORS = [
  { icon: "📸", title: "Photo Count", desc: "Slide to set how many photos you'll upload — pricing scales with volume.", example: "500 · 1,000 · 2,500 · 5,000+" },
  { icon: "☁️", title: "Storage Duration", desc: "Choose how long guests can access and download photos after the event.", example: "7 days · 30 days · 90 days · 1 year" },
  { icon: "👥", title: "Guest Uploads", desc: "Allow guests to contribute their own photos to the event gallery.", example: "Disabled · 100 · 500 · Unlimited" },
  { icon: "⭐", title: "Add-ons", desc: "Watermarking, AI scene tags, custom branding — add only what you need.", example: "Pick and choose per event" },
];

const DEFAULT_TESTIMONIALS: Testimonial[] = [
  {
    id: "1",
    name: "Rajesh Mehta",
    role: "Lead Photographer",
    company: "RMStudios",
    text: "SnapFind cut our post-event delivery from 3 days to 3 hours. Clients love finding their photos by selfie — it feels like magic.",
    rating: 5,
    verified: true,
  },
  {
    id: "2",
    name: "Priya Sharma",
    role: "Wedding Planner",
    company: "BlissEvents",
    text: "We used to spend hours sharing photos on WhatsApp. Now we share one link and every guest gets their photos automatically.",
    rating: 5,
    verified: true,
  },
  {
    id: "3",
    name: "Amit Verma",
    role: "Corporate Events Manager",
    company: "TechCorp India",
    text: "The face clustering accuracy is outstanding. 800 attendees, 4,000 photos — everyone found their pictures within seconds.",
    rating: 5,
    verified: true,
  },
];

const FAQS: FAQ[] = [
  { q: "How accurate is the face recognition?", a: "We use InsightFace's buffalo_s model which achieves 99.2% accuracy on standard benchmarks. In real event conditions with varied lighting, expect 96-98% accuracy.", category: "Technology" },
  { q: "How long does processing take?", a: "Processing takes approximately 3-4 minutes for 1,000 photos. It runs entirely in the background — you can share the event guest link immediately while processing completes.", category: "Performance" },
  { q: "Is guest data private and secure?", a: "Yes. Selfies uploaded for search are processed in memory and never stored. Event photos are stored securely with AES-256 encryption and deleted after your chosen retention period.", category: "Security" },
  { q: "Do guests need to create an account?", a: "No. Guests simply open your event link, take or upload a selfie, and instantly see their photos. Zero friction for attendees.", category: "Guest Experience" },
  { q: "What photo formats are supported?", a: "JPG, JPEG, PNG, WebP, and HEIC (iPhone photos). Maximum 20MB per photo. Bulk upload supports thousands of files simultaneously.", category: "Technical" },
  { q: "How much does a paid event cost?", a: "Pricing is pay-per-event and depends on three factors you control: photo count, storage duration, and optional guest uploads. Use the live configurator on our pricing page to see your exact price before paying. There are no subscriptions or monthly fees.", category: "Pricing" },
  { q: "Can I use this for corporate events?", a: "Absolutely. PIN-protected events and private guest portals make SnapFind ideal for conferences, award ceremonies, team outings and corporate functions.", category: "Use Cases" },
];

const TRUST_BADGES = [
  { icon: Lock, label: "SSL Secured" },
  { icon: ShieldCheck, label: "GDPR Compliant" },
  { icon: Server, label: "99.9% Uptime" },
  { icon: CreditCard, label: "Razorpay" },
];

/* ═══════════════════════════════════════════════════════════════════════════
   UTILITY COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

// Animated Particle Background
function ParticleBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(20)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf]"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
          }}
          animate={{
            y: [0, -100, 0],
            opacity: [0, 0.5, 0],
            scale: [0, 1, 0],
          }}
          transition={{
            duration: 8 + Math.random() * 4,
            repeat: Infinity,
            delay: Math.random() * 5,
            ease: "linear",
          }}
        />
      ))}
    </div>
  );
}

// Gradient Orbs
function GradientOrbs() {
  return (
    <>
      <motion.div
        className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full opacity-30 blur-[120px]"
        style={{ background: "radial-gradient(circle, #6c63ff 0%, transparent 70%)" }}
        animate={{ x: [0, 50, 0], y: [0, 30, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full opacity-20 blur-[100px]"
        style={{ background: "radial-gradient(circle, #3ecfcf 0%, transparent 70%)" }}
        animate={{ x: [0, -40, 0], y: [0, -20, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
    </>
  );
}

// Newsletter Form
function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setStatus("loading");
    // Simulate API call
    await new Promise((r) => setTimeout(r, 1500));
    setStatus("success");
    setEmail("");

    setTimeout(() => setStatus("idle"), 3000);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
      <div className="relative flex-1">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:border-[#6c63ff]/50 transition-colors"
          disabled={status === "loading" || status === "success"}
        />
      </div>
      <motion.button
        type="submit"
        disabled={status === "loading" || status === "success"}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="px-6 py-3 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white font-semibold rounded-xl flex items-center justify-center gap-2 disabled:opacity-70 transition-all"
      >
        {status === "loading" && <Loader2 className="w-4 h-4 animate-spin" />}
        {status === "success" && <CheckCircle className="w-4 h-4" />}
        {status === "success" ? "Subscribed!" : "Subscribe"}
      </motion.button>
    </form>
  );
}

// Live Activity Indicator
function LiveActivityIndicator({ count }: { count: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed bottom-6 left-6 z-40 bg-[#111827]/90 backdrop-blur-xl border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3 shadow-xl"
    >
      <div className="relative">
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
        <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
      </div>
      <div>
        <p className="text-white text-xs font-medium">{count.toLocaleString()} photos processed today</p>
        <p className="text-gray-500 text-[10px]">Live activity</p>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

// Navbar with scroll effects
function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("");

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);

      // Track active section
      const sections = ["features", "how", "pricing", "faq"];
      for (const section of sections) {
        const el = document.getElementById(section);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 100 && rect.bottom >= 100) {
            setActiveSection(section);
            break;
          }
        }
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 w-full z-50 transition-all duration-500 ${
        scrolled
          ? "bg-[#090d1a]/95 backdrop-blur-xl shadow-lg shadow-black/20 border-b border-white/5"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <motion.div
            className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#6c63ff] to-[#3ecfcf] flex items-center justify-center shadow-lg shadow-[#6c63ff]/20"
            whileHover={{ scale: 1.05, rotate: 5 }}
            whileTap={{ scale: 0.95 }}
          >
            <Camera size={18} className="text-white" />
          </motion.div>
          <span className="font-bold text-white text-xl tracking-tight">
            Snap<span className="text-[#3ecfcf]">Find</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((l) => {
            const isActive = activeSection === l.href.replace("#", "");
            const isPricing = l.label === "Pricing";

            const linkContent = (
              <motion.span
                className={`relative px-4 py-2 text-sm font-medium transition-colors rounded-lg ${
                  isPricing
                    ? "text-[#3ecfcf]"
                    : isActive
                    ? "text-white"
                    : "text-gray-400 hover:text-white"
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {isActive && (
                  <motion.div
                    layoutId="navIndicator"
                    className="absolute inset-0 bg-white/5 rounded-lg border border-white/10"
                    transition={{ type: "spring", duration: 0.3 }}
                  />
                )}
                <span className="relative">{l.label}</span>
              </motion.span>
            );

            return l.href.startsWith("/") ? (
              <Link key={l.label} href={l.href}>
                {linkContent}
              </Link>
            ) : (
              <a key={l.label} href={l.href}>
                {linkContent}
              </a>
            );
          })}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login?mode=login"
            className="text-sm text-gray-300 hover:text-white transition-colors px-4 py-2"
          >
            Sign In
          </Link>
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Link
              href="/login?mode=register"
              className="text-sm font-semibold bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity shadow-lg shadow-[#6c63ff]/20"
            >
              Get Started Free
            </Link>
          </motion.div>
        </div>

        <motion.button
          className="md:hidden text-white p-2"
          onClick={() => setOpen(!open)}
          whileTap={{ scale: 0.9 }}
          aria-label="Toggle menu"
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </motion.button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="md:hidden bg-[#090d1a]/98 backdrop-blur-xl border-t border-white/10"
          >
            <div className="px-6 py-4 flex flex-col gap-2">
              {NAV_LINKS.map((l, i) => (
                <motion.div
                  key={l.label}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  {l.href.startsWith("/") ? (
                    <Link
                      href={l.href}
                      className={`block py-2.5 ${l.label === "Pricing" ? "text-[#3ecfcf] font-medium" : "text-gray-300"}`}
                      onClick={() => setOpen(false)}
                    >
                      {l.label}
                    </Link>
                  ) : (
                    <a
                      href={l.href}
                      className="block py-2.5 text-gray-300 hover:text-white"
                      onClick={() => setOpen(false)}
                    >
                      {l.label}
                    </a>
                  )}
                </motion.div>
              ))}
              <div className="pt-4 border-t border-white/10 mt-2 flex flex-col gap-3">
                <Link
                  href="/login?mode=login"
                  className="text-gray-300 hover:text-white py-2"
                  onClick={() => setOpen(false)}
                >
                  Sign In
                </Link>
                <Link
                  href="/login?mode=register"
                  className="bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white text-center py-3 rounded-xl font-semibold"
                  onClick={() => setOpen(false)}
                >
                  Get Started Free
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

// FAQ Item with smooth animation
function FAQItem({ q, a, category }: FAQ) {
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      layout
      className={`border rounded-xl overflow-hidden transition-all duration-300 ${
        open ? "border-[#6c63ff]/40 bg-[#6c63ff]/5" : "border-white/10 hover:border-white/20"
      }`}
    >
      <motion.button
        layout
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-5 text-left"
      >
        <div className="flex items-center gap-3">
          {category && (
            <span className="text-[10px] font-mono text-[#3ecfcf] bg-[#3ecfcf]/10 px-2 py-0.5 rounded-full border border-[#3ecfcf]/20">
              {category}
            </span>
          )}
          <span className="text-white font-medium text-sm md:text-base">{q}</span>
        </div>
        <motion.div
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0"
        >
          <ChevronRight size={18} className="text-[#3ecfcf]" />
        </motion.div>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <p className="px-6 pb-5 text-gray-400 text-sm leading-relaxed">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Feature Card with 3D tilt effect
function FeatureCard({ feature, index }: { feature: Feature; index: number }) {
  const { icon: Icon, title, desc, tag, gradient } = feature;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.06, duration: 0.5 }}
      whileHover={{ y: -8, transition: { duration: 0.2 } }}
      className="group relative"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[#6c63ff]/10 to-[#3ecfcf]/10 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <div className="relative bg-[#111827]/80 backdrop-blur-sm border border-white/8 rounded-2xl p-6 group-hover:border-[#6c63ff]/30 transition-all duration-300">
        <div className="flex items-start justify-between mb-4">
          <motion.div
            className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient || "from-[#6c63ff]/30 to-[#3ecfcf]/20"} border border-white/10 flex items-center justify-center shadow-lg`}
            whileHover={{ scale: 1.1, rotate: 5 }}
          >
            <Icon size={22} className="text-white" />
          </motion.div>
          <span className="text-[10px] font-mono text-[#3ecfcf] bg-[#3ecfcf]/10 px-2 py-0.5 rounded-full border border-[#3ecfcf]/20">
            {tag}
          </span>
        </div>
        <h3 className="font-semibold text-white mb-2 text-lg">{title}</h3>
        <p className="text-gray-400 text-sm leading-relaxed">{desc}</p>
      </div>
    </motion.div>
  );
}

// Testimonial Card
function TestimonialCard({ testimonial, index }: { testimonial: Testimonial; index: number }) {
  const { name, role, company, text, rating, verified } = testimonial;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.1 }}
      whileHover={{ y: -4 }}
      className="group bg-gradient-to-b from-[#111827]/80 to-[#111827]/40 backdrop-blur-sm border border-white/8 rounded-2xl p-7 hover:border-[#6c63ff]/30 transition-all duration-300"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-0.5">
          {[...Array(rating)].map((_, i) => (
            <Star key={i} size={14} className="fill-[#f59e0b] text-[#f59e0b]" />
          ))}
        </div>
        {verified && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-400">
            <BadgeCheck size={12} /> Verified
          </span>
        )}
      </div>
      <p className="text-gray-300 text-sm leading-relaxed mb-6 italic">"{text}"</p>
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#6c63ff] to-[#3ecfcf] flex items-center justify-center text-sm font-bold shadow-lg">
          {name.charAt(0)}
        </div>
        <div>
          <p className="text-white text-sm font-semibold">{name}</p>
          <p className="text-gray-500 text-xs">{role}{company && `, ${company}`}</p>
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */
export default function HomePage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  // Dynamic stats from API
  const [stats, setStats] = useState<PlatformStats>({
    eventsHosted: 12000,
    photosIndexed: 2000000,
    facesRecognised: 350000,
    matchAccuracy: 99.2,
    activeUsers: 2400,
    photosToday: 15420,
  });
  const [testimonials, setTestimonials] = useState<Testimonial[]>(DEFAULT_TESTIMONIALS);
  const [loading, setLoading] = useState(true);

  // Fetch dynamic data
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const API = process.env.NEXT_PUBLIC_API_URL || "";
        const res = await fetch(`${API}/public/stats`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (e) {
        // Use defaults
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const displayStats: Stat[] = [
    { value: stats.eventsHosted, suffix: "+", label: "Events Hosted", trend: 12 },
    { value: stats.photosIndexed / 1000000, suffix: "M+", label: "Photos Indexed", decimals: 1, trend: 8 },
    { value: stats.facesRecognised / 1000, suffix: "K+", label: "Faces Recognised", decimals: 0, trend: 15 },
    { value: stats.matchAccuracy, suffix: "%", label: "Match Accuracy", decimals: 1 },
  ];

  return (
    <>
      <Head>
        <title>SnapFind AI — Find Your Event Photos Instantly with Face Search</title>
        <meta name="description" content="SnapFind uses AI face recognition to help event guests instantly find every photo of themselves. Built for wedding photographers, corporate events and professional organisers in India." />
        <meta name="keywords" content="event photo search, face recognition photos, wedding photo delivery, AI photo finder, event photography software, selfie photo search India" />
        <meta property="og:title" content="SnapFind AI — Find Your Event Photos Instantly" />
        <meta property="og:description" content="Upload a selfie, find all your event photos in seconds. AI-powered face search for photographers and event organisers." />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="SnapFind AI — Find Your Event Photos Instantly" />
        <meta name="twitter:description" content="Upload a selfie, find all your event photos in seconds." />
        <link rel="canonical" href="https://snapfind.ai" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "name": "SnapFind AI",
          "applicationCategory": "Photography",
          "description": "AI-powered face recognition for event photo delivery",
          "operatingSystem": "Web",
          "offers": { "@type": "Offer", "price": "0", "priceCurrency": "INR" },
          "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.9", "reviewCount": "847" },
        }) }} />
      </Head>

      <div className="bg-[#090d1a] text-white font-['Sora',sans-serif] overflow-x-hidden">
        {/* Global Styles */}
        <style jsx global>{`
          @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
          html { scroll-behavior: smooth; }
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-track { background: #090d1a; }
          ::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #6c63ff, #3ecfcf); border-radius: 3px; }
          ::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, #7c73ff, #4edfdf); }

          .text-gradient {
            background: linear-gradient(135deg, #fff 0%, #a5b4fc 50%, #3ecfcf 100%);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            background-clip: text;
          }

          .mesh-bg {
            background:
              radial-gradient(ellipse 80% 50% at 20% 20%, #6c63ff12 0%, transparent 60%),
              radial-gradient(ellipse 60% 40% at 80% 10%, #3ecfcf10 0%, transparent 50%),
              radial-gradient(ellipse 50% 60% at 50% 80%, #6c63ff08 0%, transparent 60%);
          }

          .glass {
            background: rgba(17, 24, 39, 0.6);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
          }

          @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }

          .animate-float { animation: float 4s ease-in-out infinite; }
        `}</style>

        <Navbar />

        {/* ═══════════════ HERO SECTION ═══════════════ */}
        <section
          ref={heroRef}
          className="relative min-h-screen flex items-center pt-24 pb-20 overflow-hidden"
        >
          <ParticleBackground />
          <GradientOrbs />

          {/* Grid overlay */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
              backgroundSize: "60px 60px",
            }}
          />

          <motion.div
            style={{ y: heroY, opacity: heroOpacity }}
            className="max-w-7xl mx-auto px-6 w-full relative z-10"
          >
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              {/* Hero Text */}
              <motion.div variants={stagger} initial="hidden" animate="show">
                <motion.div
                  variants={fadeUp}
                  className="inline-flex items-center gap-2.5 bg-gradient-to-r from-[#6c63ff]/10 to-[#3ecfcf]/10 border border-white/10 rounded-full px-4 py-2 text-xs text-[#3ecfcf] font-medium mb-8"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3ecfcf] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#3ecfcf]"></span>
                  </span>
                  AI-Powered Event Photo Delivery
                </motion.div>

                <motion.h1
                  variants={fadeUp}
                  className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.1] tracking-tight"
                >
                  Find Every{" "}
                  <span className="text-gradient">Photo of You</span>{" "}
                  Instantly.
                </motion.h1>

                <motion.p
                  variants={fadeUp}
                  className="mt-6 text-lg text-gray-400 leading-relaxed max-w-xl"
                >
                  Upload a selfie. Get every photo from the event in seconds.
                  SnapFind uses advanced face recognition to automate photo
                  delivery for photographers and event organisers across India.
                </motion.p>

                <motion.div variants={fadeUp} className="mt-10 flex flex-wrap gap-4">
                  <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <Link
                      href="/public-search"
                      className="group flex items-center gap-2 px-7 py-4 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white font-semibold rounded-xl transition-all shadow-lg shadow-[#6c63ff]/25 hover:shadow-[#6c63ff]/40"
                    >
                      <Search size={18} className="group-hover:rotate-12 transition-transform" />
                      Find My Photos
                    </Link>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <Link
                      href="/login?mode=register"
                      className="group flex items-center gap-2 px-7 py-4 border border-white/20 text-white font-semibold rounded-xl hover:bg-white/5 transition-all"
                    >
                      I'm an Organiser
                      <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                    </Link>
                  </motion.div>
                </motion.div>

                {/* Social Proof */}
                <motion.div variants={fadeUp} className="mt-12 flex items-center gap-6">
                  <div className="flex -space-x-3">
                    {["#6c63ff", "#3ecfcf", "#f59e0b", "#ec4899", "#22c55e"].map((c, i) => (
                      <motion.div
                        key={i}
                        className="w-9 h-9 rounded-full border-2 border-[#090d1a] shadow-lg"
                        style={{ background: `linear-gradient(135deg, ${c}, ${c}cc)` }}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.8 + i * 0.1 }}
                      />
                    ))}
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} size={12} className="fill-[#f59e0b] text-[#f59e0b]" />
                      ))}
                      <span className="text-white text-xs font-medium ml-1">4.9</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Trusted by <span className="text-white font-medium">{stats.activeUsers.toLocaleString()}+ photographers</span>
                    </p>
                  </div>
                </motion.div>
              </motion.div>

              {/* Hero Visual - Interactive Demo Card */}
              <motion.div
                initial={{ opacity: 0, x: 40, rotateY: -10 }}
                animate={{ opacity: 1, x: 0, rotateY: 0 }}
                transition={{ duration: 0.8, delay: 0.3 }}
                className="relative perspective-1000"
              >
                <div className="relative bg-gradient-to-br from-[#111827]/90 to-[#111827]/70 border border-white/10 rounded-2xl p-6 backdrop-blur-xl shadow-2xl shadow-[#6c63ff]/10">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <p className="text-xs text-gray-500 font-mono uppercase tracking-wider">Searching Event</p>
                      <p className="text-white font-semibold mt-0.5">Sharma Wedding · Dec 2025</p>
                    </div>
                    <span className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 text-xs px-3 py-1.5 rounded-full border border-emerald-500/20 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Live
                    </span>
                  </div>

                  {/* Photo Grid */}
                  <div className="grid grid-cols-3 gap-2.5 mb-5">
                    {[...Array(9)].map((_, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: i < 6 ? 1 : 0.2, scale: 1 }}
                        transition={{ delay: 0.5 + i * 0.08, duration: 0.4 }}
                        className={`rounded-xl h-24 relative overflow-hidden group ${
                          i < 6
                            ? "bg-gradient-to-br from-[#6c63ff]/30 to-[#3ecfcf]/20 border border-[#6c63ff]/30"
                            : "bg-white/5 border border-white/5"
                        }`}
                      >
                        {i < 6 && (
                          <motion.div
                            className="absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-[#3ecfcf] flex items-center justify-center shadow-lg"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.8 + i * 0.08, type: "spring" }}
                          >
                            <Check size={12} className="text-[#090d1a]" strokeWidth={3} />
                          </motion.div>
                        )}
                        {i === 0 && (
                          <div className="absolute inset-0 bg-gradient-to-t from-[#6c63ff]/50 to-transparent" />
                        )}
                      </motion.div>
                    ))}
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-2">
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: "68%" }}
                        transition={{ duration: 1.5, delay: 1, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] rounded-full"
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 mb-4">
                    <span>6 of 847 photos matched</span>
                    <span className="text-[#3ecfcf] font-medium">68%</span>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="flex-1 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white text-xs font-semibold py-3 rounded-xl transition-opacity hover:opacity-90"
                    >
                      Download All (6)
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="px-4 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-white transition-colors"
                    >
                      <Search size={16} />
                    </motion.button>
                  </div>
                </div>

                {/* Floating Stats Card */}
                <motion.div
                  initial={{ opacity: 0, y: 20, x: -20 }}
                  animate={{ opacity: 1, y: 0, x: 0 }}
                  transition={{ delay: 1.4, duration: 0.5 }}
                  className="absolute -bottom-6 -left-6 bg-[#111827]/95 backdrop-blur-xl border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3 shadow-xl"
                >
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6c63ff] to-[#3ecfcf] flex items-center justify-center shadow-lg">
                    <Zap size={18} className="text-white" />
                  </div>
                  <div>
                    <p className="text-white text-xs font-semibold">Processed in 3.2 min</p>
                    <p className="text-gray-500 text-[10px]">847 photos · 23 clusters</p>
                  </div>
                </motion.div>

                {/* Decorative glow */}
                <div className="absolute -inset-4 bg-gradient-to-r from-[#6c63ff]/10 to-[#3ecfcf]/10 rounded-3xl blur-2xl -z-10" />
              </motion.div>
            </div>
          </motion.div>
        </section>

        {/* ═══════════════ TRUST BADGES ═══════════════ */}
        <section className="py-8 border-y border-white/5 bg-[#0d1120]/50">
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex flex-wrap items-center justify-center gap-6 md:gap-12">
              {TRUST_BADGES.map(({ icon: Icon, label }, i) => (
                <motion.div
                  key={label}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center gap-2 text-gray-500"
                >
                  <Icon size={16} className="text-[#3ecfcf]" />
                  <span className="text-xs font-medium">{label}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ STATS ═══════════════ */}
        <section className="py-20 border-b border-white/5 bg-[#0d1120]">
          <div className="max-w-6xl mx-auto px-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
              {displayStats.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="text-center"
                >
                  <p className="text-3xl md:text-4xl lg:text-5xl font-bold text-white">
                    <CountUp end={stat.value} duration={2.5} decimals={stat.decimals} enableScrollSpy scrollSpyOnce />
                    <span className="text-[#3ecfcf]">{stat.suffix}</span>
                  </p>
                  <p className="text-gray-500 text-sm mt-2">{stat.label}</p>
                  {stat.trend && (
                    <p className="text-emerald-400 text-xs mt-1 flex items-center justify-center gap-1">
                      <TrendingUp size={12} /> +{stat.trend}% this month
                    </p>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ FEATURES ═══════════════ */}
        <section id="features" className="py-28 mesh-bg relative">
          <GradientOrbs />
          <div className="max-w-7xl mx-auto px-6 relative z-10">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <p className="text-[#6c63ff] text-sm font-semibold tracking-widest uppercase mb-3">
                Features
              </p>
              <h2 className="text-4xl md:text-5xl font-bold">
                Everything you need to{" "}
                <span className="text-gradient">deliver photos faster</span>
              </h2>
              <p className="text-gray-400 mt-4 max-w-2xl mx-auto">
                Built specifically for Indian event photographers and organisers.
                No generic tools — every feature solves a real problem.
              </p>
            </motion.div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
              {FEATURES.map((feature, i) => (
                <FeatureCard key={feature.title} feature={feature} index={i} />
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ HOW IT WORKS ═══════════════ */}
        <section id="how" className="py-28 bg-[#0d1120] relative overflow-hidden">
          <div className="max-w-7xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <p className="text-[#3ecfcf] text-sm font-semibold tracking-widest uppercase mb-3">
                How It Works
              </p>
              <h2 className="text-4xl md:text-5xl font-bold">
                From upload to delivery{" "}
                <span className="text-gradient">in minutes</span>
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-4 gap-8 relative">
              {/* Connection line */}
              <div className="hidden md:block absolute top-12 left-[12%] right-[12%] h-0.5">
                <div className="h-full bg-gradient-to-r from-[#6c63ff] via-[#3ecfcf] to-[#6c63ff] opacity-20" />
              </div>

              {HOW_STEPS.map(({ step, title, desc, icon: Icon }, i) => (
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.12 }}
                  className="relative text-center"
                >
                  <motion.div
                    whileHover={{ scale: 1.05, y: -5 }}
                    className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#6c63ff]/20 to-[#3ecfcf]/10 border border-[#6c63ff]/30 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-[#6c63ff]/10"
                  >
                    <Icon size={24} className="text-[#6c63ff]" />
                  </motion.div>
                  <span className="font-mono font-bold text-[#3ecfcf] text-sm">{step}</span>
                  <h3 className="font-semibold text-white text-lg mt-2 mb-2">{title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mt-16 text-center"
            >
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Link
                  href="/login?mode=register"
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white font-semibold px-8 py-4 rounded-xl hover:opacity-90 transition-opacity shadow-lg shadow-[#6c63ff]/20"
                >
                  Start Your First Event Free
                  <ArrowRight size={18} />
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* ═══════════════ TESTIMONIALS ═══════════════ */}
        <section className="py-28 mesh-bg relative">
          <div className="max-w-7xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <p className="text-[#6c63ff] text-sm font-semibold tracking-widest uppercase mb-3">
                Testimonials
              </p>
              <h2 className="text-4xl md:text-5xl font-bold">
                Loved by <span className="text-gradient">professionals</span>
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-6">
              {testimonials.map((testimonial, i) => (
                <TestimonialCard key={testimonial.id} testimonial={testimonial} index={i} />
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ PRICING ═══════════════ */}
        <section id="pricing" className="py-28 bg-[#0d1120]">
          <div className="max-w-7xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <p className="text-[#3ecfcf] text-sm font-semibold tracking-widest uppercase mb-3">
                Pricing
              </p>
              <h2 className="text-4xl md:text-5xl font-bold">
                Simple, honest <span className="text-gradient">pricing</span>
              </h2>
              <p className="text-gray-400 mt-4 max-w-xl mx-auto">
                Start free with your first event. When you need more —
                configure exactly what you need and pay only for that event.
                No subscriptions. No monthly fees.
              </p>
            </motion.div>

            {/* Plan Cards */}
            <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-12">
              {PLANS.map(({ name, price, badge, desc, features, cta, href, highlight }, i) => (
                <motion.div
                  key={name}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.12 }}
                  whileHover={{ y: -4 }}
                  className={`relative rounded-2xl p-8 flex flex-col transition-all ${
                    highlight
                      ? "bg-gradient-to-b from-[#6c63ff]/20 to-[#3ecfcf]/5 border-2 border-[#6c63ff]/50 shadow-xl shadow-[#6c63ff]/10"
                      : "bg-[#111827]/60 border border-white/8 hover:border-white/20"
                  }`}
                >
                  {badge && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white text-[10px] font-bold px-4 py-1 rounded-full tracking-widest whitespace-nowrap shadow-lg">
                      {badge}
                    </div>
                  )}

                  <div className="mb-5">
                    <h3 className="font-bold text-white text-xl mb-1">{name}</h3>
                    <p className="text-gray-500 text-sm">{desc}</p>
                  </div>

                  <div className="mb-6">
                    {price === "Custom" ? (
                      <div>
                        <span className="text-4xl font-bold text-white">Pay as you go</span>
                        <p className="text-[#3ecfcf] text-sm mt-1 font-medium">Price calculated by your event requirements</p>
                      </div>
                    ) : (
                      <div>
                        <span className="text-4xl font-bold text-white">{price}</span>
                        <span className="text-gray-400 text-sm ml-1">forever free</span>
                      </div>
                    )}
                  </div>

                  <ul className="space-y-2.5 mb-8 flex-1">
                    {features.map(({ text, included }) => (
                      <li key={text} className="flex items-start gap-2.5 text-sm">
                        {included ? (
                          <Check size={15} className="text-[#3ecfcf] shrink-0 mt-0.5" />
                        ) : (
                          <X size={15} className="text-gray-600 shrink-0 mt-0.5" />
                        )}
                        <span className={included ? "text-gray-300" : "text-gray-600"}>{text}</span>
                      </li>
                    ))}
                  </ul>

                  <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <Link
                      href={href}
                      className={`block text-center py-3 rounded-xl font-semibold text-sm transition-all ${
                        highlight
                          ? "bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white hover:opacity-90 shadow-lg shadow-[#6c63ff]/20"
                          : "border border-white/20 text-white hover:bg-white/5"
                      }`}
                    >
                      {cta}
                    </Link>
                  </motion.div>
                </motion.div>
              ))}
            </div>

            {/* Pricing Calculator CTA */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="max-w-4xl mx-auto"
            >
              <div className="relative overflow-hidden rounded-2xl border border-[#3ecfcf]/25 bg-gradient-to-r from-[#6c63ff]/10 to-[#3ecfcf]/10 p-8 flex flex-col md:flex-row items-center gap-6 text-center md:text-left">
                <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full bg-[#6c63ff]/15 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-10 -right-10 w-40 h-40 rounded-full bg-[#3ecfcf]/10 blur-3xl pointer-events-none" />

                <div className="relative flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-[#6c63ff]/25 to-[#3ecfcf]/20 border border-[#6c63ff]/30 flex items-center justify-center">
                  <Calculator size={28} className="text-[#3ecfcf]" />
                </div>

                <div className="relative flex-1">
                  <p className="text-[#3ecfcf] text-xs font-semibold tracking-widest uppercase mb-1">
                    Live Price Calculator
                  </p>
                  <h3 className="text-xl font-bold text-white mb-1">
                    Calculate your exact event cost
                  </h3>
                  <p className="text-gray-400 text-sm">
                    Adjust sliders for photos, guests & validity — see your price update in real time.
                  </p>
                </div>

                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Link
                    href="/pricing"
                    className="relative flex-shrink-0 flex items-center gap-2 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white font-semibold px-6 py-3 rounded-xl hover:opacity-90 transition-opacity text-sm whitespace-nowrap shadow-lg shadow-[#6c63ff]/20"
                  >
                    <Calculator size={15} />
                    Open Calculator
                    <ArrowRight size={14} />
                  </Link>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ═══════════════ FAQ ═══════════════ */}
        <section id="faq" className="py-28 mesh-bg">
          <div className="max-w-3xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <p className="text-[#6c63ff] text-sm font-semibold tracking-widest uppercase mb-3">
                FAQ
              </p>
              <h2 className="text-4xl md:text-5xl font-bold">
                Common <span className="text-gradient">questions</span>
              </h2>
            </motion.div>

            <div className="space-y-3">
              {FAQS.map((faq, i) => (
                <motion.div
                  key={faq.q}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                >
                  <FAQItem {...faq} />
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ CTA BANNER ═══════════════ */}
        <section className="py-24 bg-[#0d1120] relative overflow-hidden">
          <GradientOrbs />
          <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <motion.div
                initial={{ scale: 0 }}
                whileInView={{ scale: 1 }}
                viewport={{ once: true }}
                transition={{ type: "spring", delay: 0.2 }}
                className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#6c63ff] to-[#3ecfcf] flex items-center justify-center mx-auto mb-8 shadow-xl shadow-[#6c63ff]/20"
              >
                <PartyPopper size={28} className="text-white" />
              </motion.div>

              <h2 className="text-4xl md:text-5xl font-bold mb-4">
                Ready to transform your{" "}
                <span className="text-gradient">photo delivery?</span>
              </h2>
              <p className="text-gray-400 mb-10 text-lg">
                Join {stats.activeUsers.toLocaleString()}+ photographers already using SnapFind.
                Start free — no credit card required.
              </p>
              <div className="flex flex-wrap gap-4 justify-center">
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Link
                    href="/login?mode=register"
                    className="flex items-center gap-2 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white font-semibold px-8 py-4 rounded-xl hover:opacity-90 transition-opacity shadow-lg shadow-[#6c63ff]/20 text-sm"
                  >
                    Get Started Free
                    <ArrowRight size={16} />
                  </Link>
                </motion.div>
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Link
                    href="/public-search"
                    className="flex items-center gap-2 border border-white/20 text-white font-semibold px-8 py-4 rounded-xl hover:bg-white/5 transition-colors text-sm"
                  >
                    <Search size={16} />
                    Try Guest Search
                  </Link>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ═══════════════ NEWSLETTER ═══════════════ */}
        <section className="py-16 border-t border-white/5 bg-[#090d1a]">
          <div className="max-w-xl mx-auto px-6 text-center">
            <h3 className="text-xl font-bold text-white mb-2">Stay updated</h3>
            <p className="text-gray-400 text-sm mb-6">Get notified about new features, pricing updates, and tips for photographers.</p>
            <NewsletterForm />
          </div>
        </section>

        {/* ═══════════════ FOOTER ═══════════════ */}
        <footer className="bg-[#060912] border-t border-white/5 py-16">
          <div className="max-w-7xl mx-auto px-6">
            <div className="grid md:grid-cols-4 gap-10 mb-12">
              <div>
                <Link href="/" className="flex items-center gap-2.5 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#6c63ff] to-[#3ecfcf] flex items-center justify-center shadow-lg">
                    <Camera size={18} className="text-white" />
                  </div>
                  <span className="font-bold text-white text-lg">
                    Snap<span className="text-[#3ecfcf]">Find</span>
                  </span>
                </Link>
                <p className="text-gray-500 text-sm leading-relaxed mb-5">
                  AI-powered event photo delivery for photographers and organisers across India.
                </p>
                <div className="flex gap-3">
                  <a href="mailto:narendradangi999@gmail.com" className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-gray-400 hover:text-white hover:border-[#6c63ff]/50 transition-all">
                    <Mail size={15} />
                  </a>
                </div>
              </div>

              <div>
                <p className="text-white font-semibold text-sm mb-4">Product</p>
                <ul className="space-y-3">
                  <li><a href="#features" className="text-gray-500 text-sm hover:text-white transition-colors">Features</a></li>
                  <li><Link href="/pricing" className="text-gray-500 text-sm hover:text-white transition-colors">Pricing Calculator</Link></li>
                  <li><a href="#how" className="text-gray-500 text-sm hover:text-white transition-colors">How It Works</a></li>
                  <li><a href="#faq" className="text-gray-500 text-sm hover:text-white transition-colors">FAQ</a></li>
                </ul>
              </div>

              <div>
                <p className="text-white font-semibold text-sm mb-4">Account</p>
                <ul className="space-y-3">
                  <li><Link href="/login?mode=login" className="text-gray-500 text-sm hover:text-white transition-colors">Sign In</Link></li>
                  <li><Link href="/login?mode=register" className="text-gray-500 text-sm hover:text-white transition-colors">Create Account</Link></li>
                  <li><Link href="/dashboard" className="text-gray-500 text-sm hover:text-white transition-colors">Organiser Dashboard</Link></li>
                  <li><Link href="/public-search" className="text-gray-500 text-sm hover:text-white transition-colors">Find My Photos</Link></li>
                </ul>
              </div>

              <div>
                <p className="text-white font-semibold text-sm mb-4">Legal</p>
                <ul className="space-y-3">
                  <li><a href="#" className="text-gray-500 text-sm hover:text-white transition-colors">Privacy Policy</a></li>
                  <li><a href="#" className="text-gray-500 text-sm hover:text-white transition-colors">Terms of Service</a></li>
                  <li><a href="#" className="text-gray-500 text-sm hover:text-white transition-colors">Refund Policy</a></li>
                </ul>
                <div className="mt-6 pt-6 border-t border-white/5">
                  <p className="text-gray-600 text-[10px] font-semibold uppercase tracking-wider mb-2">Admin</p>
                  <Link href="/admin" className="inline-flex items-center gap-1.5 text-gray-500 hover:text-[#6c63ff] text-xs transition-colors">
                    <ShieldCheck size={12} />
                    Admin Panel
                  </Link>
                </div>
              </div>
            </div>

            <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
              <p className="text-gray-600 text-sm">
                © {new Date().getFullYear()} {APP_CONFIG.name}. All rights reserved.
              </p>
              <p className="text-gray-600 text-sm flex items-center gap-1">
                Made with <Heart size={12} className="text-red-500 fill-red-500" /> for Indian event photographers
              </p>
            </div>
          </div>
        </footer>
      </div>

      {/* Live Activity Indicator */}
      <LiveActivityIndicator count={stats.photosToday} />
    </>
  );
}