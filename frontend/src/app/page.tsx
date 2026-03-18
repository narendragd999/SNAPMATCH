"use client";

import Head from "next/head";
import Link from "next/link";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import CountUp from "react-countup";
import { useState, useEffect, useRef } from "react";
import {
  Camera, Search, Users, Download, Shield, Zap,
  ChevronRight, Star, Check, Menu, X, ArrowRight,
  Image, Clock, Award, Globe, Mail, Phone
} from "lucide-react";
import { APP_CONFIG } from "@/config/app";

/* ─── tiny helpers ─────────────────────────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  show: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] },
  }),
};

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };

/* ─── data ─────────────────────────────────────────────────── */
const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

const STATS = [
  { value: 12000, suffix: "+", label: "Events Hosted" },
  { value: 2, suffix: "M+", label: "Photos Indexed" },
  { value: 350, suffix: "K+", label: "Faces Recognised" },
  { value: 99.2, suffix: "%", label: "Match Accuracy", decimals: 1 },
];

const FEATURES = [
  {
    icon: Search,
    title: "Selfie Face Search",
    desc: "Guests upload a single selfie and instantly receive every photo of themselves from the entire event — no manual browsing.",
    tag: "Core",
  },
  {
    icon: Users,
    title: "Smart Face Clustering",
    desc: "AI automatically groups photos by person using InsightFace embeddings + FAISS indexing. Zero manual tagging required.",
    tag: "AI",
  },
  {
    icon: Download,
    title: "Bulk ZIP Download",
    desc: "Guests download their complete photo collection in one click. Organisers export any cluster or the entire event instantly.",
    tag: "Popular",
  },
  {
    icon: Shield,
    title: "PIN-Protected Events",
    desc: "Every event gets a private access link with optional PIN protection. Only invited guests can search and download photos.",
    tag: "Security",
  },
  {
    icon: Zap,
    title: "Fast Bulk Upload",
    desc: "Upload thousands of photos at once via presigned MinIO URLs. Direct browser-to-storage transfers with real-time progress.",
    tag: "Performance",
  },
  {
    icon: Globe,
    title: "Public Guest Portal",
    desc: "Share a single link with all event attendees. No app download, no account needed — just a selfie to find their photos.",
    tag: "UX",
  },
  {
    icon: Image,
    title: "Scene & Object AI",
    desc: "Places365 + YOLO automatically tag scene types and objects, enabling rich filtering: 'outdoor portraits', 'stage shots', etc.",
    tag: "AI",
  },
  {
    icon: Award,
    title: "Watermarking",
    desc: "Protect your work by applying custom watermarks to delivered photos. Toggle per event, adjust opacity and position.",
    tag: "Pro",
  },
];

const HOW_STEPS = [
  {
    step: "01",
    title: "Upload Event Photos",
    desc: "Drag & drop or select thousands of photos. Our bulk uploader handles them in parallel batches with live progress tracking.",
  },
  {
    step: "02",
    title: "AI Processes & Clusters",
    desc: "InsightFace detects and embeds every face. FAISS builds a searchable index. 1,000 photos clustered in under 4 minutes on CPU.",
  },
  {
    step: "03",
    title: "Share Guest Link",
    desc: "Send one link to all attendees. They take a selfie, our AI finds every photo of them across the entire event instantly.",
  },
  {
    step: "04",
    title: "Download & Deliver",
    desc: "Guests download their photos in one ZIP. You get a professional delivery done — no WhatsApp bulk-sending, no manual sorting.",
  },
];

// Pricing is pay-per-event with a custom configurator — no fixed tiers.
// PLANS below are used only for the FREE plan card + the "Build Your Event" CTA card.
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
      { text: "Custom storage duration (slider)", included: true },
      { text: "Guest upload portal (optional)", included: true },
      { text: "Bulk ZIP download", included: true },
      { text: "AI face search + clustering", included: true },
      { text: "AI scene & object tags", included: true },
      { text: "Custom watermarking", included: true },
      { text: "PIN protection", included: true },
      { text: "Custom guest upload limit", included: true },
      { text: "Longer cloud storage", included: true },
    ],
    cta: "Configure Your Event",
    href: "/billing/create-event-order",
    highlight: true,
  },
];

// Pay-per-event pricing factors shown in the configurator section
const PRICING_FACTORS = [
  {
    icon: "📸",
    title: "Photo Count",
    desc: "Slide to set how many photos you'll upload — pricing scales with volume.",
    example: "500 · 1,000 · 2,500 · 5,000+",
  },
  {
    icon: "☁️",
    title: "Storage Duration",
    desc: "Choose how long guests can access and download photos after the event.",
    example: "7 days · 30 days · 90 days · 1 year",
  },
  {
    icon: "👥",
    title: "Guest Uploads",
    desc: "Allow guests to contribute their own photos to the event gallery.",
    example: "Disabled · 100 · 500 · Unlimited",
  },
  {
    icon: "⭐",
    title: "Add-ons",
    desc: "Watermarking, AI scene tags, custom branding — add only what you need.",
    example: "Pick and choose per event",
  },
];

const TESTIMONIALS = [
  {
    name: "Rajesh Mehta",
    role: "Lead Photographer, RMStudios",
    text: "SnapFind cut our post-event delivery from 3 days to 3 hours. Clients love finding their photos by selfie — it feels like magic.",
    rating: 5,
  },
  {
    name: "Priya Sharma",
    role: "Wedding Planner, BlissEvents",
    text: "We used to spend hours sharing photos on WhatsApp. Now we share one link and every guest gets their photos automatically.",
    rating: 5,
  },
  {
    name: "Amit Verma",
    role: "Corporate Events Manager",
    text: "The face clustering accuracy is outstanding. 800 attendees, 4,000 photos — everyone found their pictures within seconds.",
    rating: 5,
  },
];

const FAQS = [
  {
    q: "How accurate is the face recognition?",
    a: "We use InsightFace's buffalo_s model which achieves 99.2% accuracy on standard benchmarks. In real event conditions with varied lighting, expect 96-98% accuracy.",
  },
  {
    q: "How long does processing take?",
    a: "Processing takes approximately 3-4 minutes for 1,000 photos. It runs entirely in the background — you can share the event guest link immediately while processing completes.",
  },
  {
    q: "Is guest data private and secure?",
    a: "Yes. Selfies uploaded for search are processed in memory and never stored. Event photos are stored securely and deleted after your chosen retention period.",
  },
  {
    q: "Do guests need to create an account?",
    a: "No. Guests simply open your event link, take or upload a selfie, and instantly see their photos. Zero friction for attendees.",
  },
  {
    q: "What photo formats are supported?",
    a: "JPG, JPEG, PNG, WebP, and HEIC (iPhone photos). Maximum 20MB per photo. Bulk upload supports thousands of files simultaneously.",
  },
  {
    q: "How much does a paid event cost?",
    a: "Pricing is pay-per-event and depends on three factors you control: photo count, storage duration, and optional guest uploads. Use the live configurator on our pricing page to see your exact price before paying. There are no subscriptions or monthly fees.",
  },
  {
    q: "Can I use this for corporate events?",
    a: "Absolutely. PIN-protected events and private guest portals make SnapFind ideal for conferences, award ceremonies, team outings and corporate functions.",
  },
];

/* ─── sub-components ───────────────────────────────────────── */
function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <header
      className={`fixed top-0 w-full z-50 transition-all duration-300 ${
        scrolled ? "bg-[#090d1a]/95 backdrop-blur-xl shadow-lg shadow-black/20" : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6c63ff] to-[#3ecfcf] flex items-center justify-center">
            <Camera size={16} className="text-white" />
          </div>
          <span className="font-bold text-white text-lg tracking-tight">
            Snap<span className="text-[#3ecfcf]">Find</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login?mode=login"
            className="text-sm text-gray-300 hover:text-white transition px-4 py-2"
          >
            Sign In
          </Link>
          <Link
            href="/login?mode=register"
            className="text-sm font-semibold bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white px-5 py-2.5 rounded-lg hover:opacity-90 transition"
          >
            Get Started Free
          </Link>
        </div>

        <button
          className="md:hidden text-white"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-[#090d1a]/98 border-t border-white/10 px-6 py-4 flex flex-col gap-4"
          >
            {NAV_LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="text-gray-300 hover:text-white"
                onClick={() => setOpen(false)}
              >
                {l.label}
              </a>
            ))}
            <Link
              href="/login?mode=login"
              className="text-gray-300 hover:text-white"
              onClick={() => setOpen(false)}
            >
              Sign In
            </Link>
            <Link
              href="/login?mode=register"
              className="bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white text-center py-2.5 rounded-lg font-semibold"
              onClick={() => setOpen(false)}
            >
              Get Started Free
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="border border-white/10 rounded-xl overflow-hidden cursor-pointer"
      onClick={() => setOpen(!open)}
    >
      <div className="flex items-center justify-between px-6 py-5">
        <span className="text-white font-medium text-sm md:text-base">{q}</span>
        <ChevronRight
          size={18}
          className={`text-[#3ecfcf] shrink-0 transition-transform duration-300 ${open ? "rotate-90" : ""}`}
        />
      </div>
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
    </div>
  );
}

/* ─── main page ────────────────────────────────────────────── */
export default function HomePage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <>
      <Head>
        <title>SnapFind AI — Find Your Event Photos Instantly with Face Search</title>
        <meta
          name="description"
          content="SnapFind uses AI face recognition to help event guests instantly find every photo of themselves. Built for wedding photographers, corporate events and professional organisers in India."
        />
        <meta name="keywords" content="event photo search, face recognition photos, wedding photo delivery, AI photo finder, event photography software, selfie photo search India" />
        <meta property="og:title" content="SnapFind AI — Find Your Event Photos Instantly" />
        <meta property="og:description" content="Upload a selfie, find all your event photos in seconds. AI-powered face search for photographers and event organisers." />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="canonical" href="https://snapfind.ai" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{__html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "name": "SnapFind AI",
          "applicationCategory": "Photography",
          "description": "AI-powered face recognition for event photo delivery",
          "offers": {
            "@type": "Offer",
            "price": "0",
            "priceCurrency": "INR"
          },
          "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": "4.9",
            "reviewCount": "847"
          }
        })}} />
      </Head>

      <div className="bg-[#090d1a] text-white font-['Sora',sans-serif] overflow-x-hidden">
        <style jsx global>{`
          @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
          html { scroll-behavior: smooth; }
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-track { background: #090d1a; }
          ::-webkit-scrollbar-thumb { background: #6c63ff; border-radius: 3px; }
          .grain::after {
            content: '';
            position: fixed; inset: 0; z-index: 999;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
            pointer-events: none; opacity: 0.35;
          }
          .glow-purple { box-shadow: 0 0 80px -20px #6c63ff80; }
          .glow-teal { box-shadow: 0 0 80px -20px #3ecfcf60; }
          .text-gradient {
            background: linear-gradient(135deg, #fff 0%, #a5b4fc 50%, #3ecfcf 100%);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          }
          .card-hover {
            transition: transform 0.3s ease, box-shadow 0.3s ease;
          }
          .card-hover:hover {
            transform: translateY(-4px);
            box-shadow: 0 20px 60px -10px #6c63ff40;
          }
          .mesh-bg {
            background:
              radial-gradient(ellipse 80% 50% at 20% 20%, #6c63ff18 0%, transparent 60%),
              radial-gradient(ellipse 60% 40% at 80% 10%, #3ecfcf12 0%, transparent 50%),
              radial-gradient(ellipse 50% 60% at 50% 80%, #6c63ff10 0%, transparent 60%);
          }
        `}</style>

        <div className="grain" />
        <Navbar />

        {/* ═══════════════ HERO ═══════════════ */}
        <section
          ref={heroRef}
          className="relative min-h-screen flex items-center pt-24 pb-16 overflow-hidden mesh-bg"
        >
          {/* grid lines */}
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
              backgroundSize: "60px 60px",
            }}
          />

          <motion.div
            style={{ y: heroY, opacity: heroOpacity }}
            className="max-w-7xl mx-auto px-6 w-full"
          >
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <motion.div variants={stagger} initial="hidden" animate="show">
                <motion.div
                  variants={fadeUp}
                  className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-xs text-[#3ecfcf] font-medium mb-8"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3ecfcf] animate-pulse" />
                  AI-Powered Event Photo Delivery
                </motion.div>

                <motion.h1
                  variants={fadeUp}
                  className="text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.05] tracking-tight"
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
                  <Link
                    href="/public-search"
                    className="flex items-center gap-2 px-7 py-3.5 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white font-semibold rounded-xl hover:opacity-90 transition text-sm glow-purple"
                  >
                    <Search size={16} />
                    Find My Photos
                  </Link>
                  <Link
                    href="/login?mode=register"
                    className="flex items-center gap-2 px-7 py-3.5 border border-white/20 text-white font-semibold rounded-xl hover:bg-white/5 transition text-sm"
                  >
                    I'm an Organiser
                    <ArrowRight size={16} />
                  </Link>
                </motion.div>

                <motion.div
                  variants={fadeUp}
                  className="mt-12 flex items-center gap-6"
                >
                  <div className="flex -space-x-2">
                    {["#6c63ff","#3ecfcf","#f59e0b","#ec4899","#22c55e"].map((c, i) => (
                      <div
                        key={i}
                        className="w-8 h-8 rounded-full border-2 border-[#090d1a]"
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} size={12} className="fill-[#f59e0b] text-[#f59e0b]" />
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Trusted by <span className="text-white font-medium">2,400+ photographers</span>
                    </p>
                  </div>
                </motion.div>
              </motion.div>

              {/* hero card */}
              <motion.div
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 0.3 }}
                className="relative"
              >
                <div className="bg-[#111827]/80 border border-white/10 rounded-2xl p-6 backdrop-blur-xl glow-teal">
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <p className="text-xs text-gray-500 font-mono">SEARCHING EVENT</p>
                      <p className="text-white font-semibold">Sharma Wedding · Dec 2025</p>
                    </div>
                    <span className="flex items-center gap-1.5 bg-[#3ecfcf]/10 text-[#3ecfcf] text-xs px-3 py-1 rounded-full border border-[#3ecfcf]/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3ecfcf] animate-pulse" />
                      Live
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5 mb-5">
                    {[...Array(9)].map((_, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: i < 6 ? 1 : 0.3 }}
                        transition={{ delay: 0.5 + i * 0.08 }}
                        className={`rounded-xl h-24 relative overflow-hidden ${
                          i < 6
                            ? "bg-gradient-to-br from-[#6c63ff]/30 to-[#3ecfcf]/20 border border-[#6c63ff]/30"
                            : "bg-white/5 border border-white/5"
                        }`}
                      >
                        {i < 6 && (
                          <div className="absolute bottom-1.5 right-1.5 w-4 h-4 rounded-full bg-[#3ecfcf] flex items-center justify-center">
                            <Check size={10} className="text-[#090d1a]" />
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </div>

                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: "68%" }}
                    transition={{ duration: 1.5, delay: 1, ease: "easeOut" }}
                    className="h-1.5 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] rounded-full mb-2"
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>6 of 847 photos matched</span>
                    <span className="text-[#3ecfcf]">68%</span>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button className="flex-1 bg-[#6c63ff] text-white text-xs font-semibold py-2.5 rounded-lg hover:opacity-90 transition">
                      Download All (6)
                    </button>
                    <button className="px-3 bg-white/5 border border-white/10 rounded-lg text-gray-400 hover:text-white transition">
                      <Search size={14} />
                    </button>
                  </div>
                </div>

                {/* floating badge */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.4 }}
                  className="absolute -bottom-5 -left-5 bg-[#111827] border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3"
                >
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#6c63ff] to-[#3ecfcf] flex items-center justify-center text-sm">
                    ⚡
                  </div>
                  <div>
                    <p className="text-white text-xs font-semibold">Processed in 3.2 min</p>
                    <p className="text-gray-500 text-[10px]">847 photos · 23 clusters</p>
                  </div>
                </motion.div>
              </motion.div>
            </div>
          </motion.div>
        </section>

        {/* ═══════════════ STATS ═══════════════ */}
        <section className="py-16 border-y border-white/5 bg-[#0d1120]">
          <div className="max-w-6xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {STATS.map(({ value, suffix, label, decimals }, i) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <p className="text-3xl md:text-4xl font-bold text-white">
                  <CountUp end={value} duration={2.5} decimals={decimals} enableScrollSpy scrollSpyOnce />
                  <span className="text-[#3ecfcf]">{suffix}</span>
                </p>
                <p className="text-gray-500 text-sm mt-1">{label}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ═══════════════ FEATURES ═══════════════ */}
        <section id="features" className="py-28 mesh-bg">
          <div className="max-w-7xl mx-auto px-6">
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
              {FEATURES.map(({ icon: Icon, title, desc, tag }, i) => (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                  className="bg-[#111827]/60 border border-white/8 rounded-2xl p-6 card-hover group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6c63ff]/20 to-[#3ecfcf]/10 border border-[#6c63ff]/20 flex items-center justify-center group-hover:from-[#6c63ff]/40 transition">
                      <Icon size={18} className="text-[#6c63ff]" />
                    </div>
                    <span className="text-[10px] font-mono text-[#3ecfcf] bg-[#3ecfcf]/10 px-2 py-0.5 rounded-full border border-[#3ecfcf]/20">
                      {tag}
                    </span>
                  </div>
                  <h3 className="font-semibold text-white mb-2">{title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ HOW IT WORKS ═══════════════ */}
        <section id="how" className="py-28 bg-[#0d1120]">
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

            <div className="grid md:grid-cols-4 gap-6 relative">
              <div className="hidden md:block absolute top-10 left-[12%] right-[12%] h-px bg-gradient-to-r from-[#6c63ff] via-[#3ecfcf] to-[#6c63ff] opacity-20" />

              {HOW_STEPS.map(({ step, title, desc }, i) => (
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.12 }}
                  className="relative text-center"
                >
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#6c63ff]/20 to-[#3ecfcf]/10 border border-[#6c63ff]/30 flex items-center justify-center mx-auto mb-5">
                    <span className="font-mono font-bold text-[#6c63ff] text-xl">{step}</span>
                  </div>
                  <h3 className="font-semibold text-white mb-2">{title}</h3>
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
              <Link
                href="/login?mode=register"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white font-semibold px-8 py-4 rounded-xl hover:opacity-90 transition glow-purple"
              >
                Start Your First Event Free
                <ArrowRight size={18} />
              </Link>
            </motion.div>
          </div>
        </section>

        {/* ═══════════════ TESTIMONIALS ═══════════════ */}
        <section className="py-28 mesh-bg">
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
              {TESTIMONIALS.map(({ name, role, text, rating }, i) => (
                <motion.div
                  key={name}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-[#111827]/60 border border-white/8 rounded-2xl p-7 card-hover"
                >
                  <div className="flex gap-1 mb-4">
                    {[...Array(rating)].map((_, j) => (
                      <Star key={j} size={14} className="fill-[#f59e0b] text-[#f59e0b]" />
                    ))}
                  </div>
                  <p className="text-gray-300 text-sm leading-relaxed mb-6">"{text}"</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#6c63ff] to-[#3ecfcf] flex items-center justify-center text-xs font-bold">
                      {name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-white text-sm font-semibold">{name}</p>
                      <p className="text-gray-500 text-xs">{role}</p>
                    </div>
                  </div>
                </motion.div>
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

            {/* ── Two plan cards ── */}
            <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-16">
              {PLANS.map(({ name, price, badge, desc, features, cta, href, highlight }, i) => (
                <motion.div
                  key={name}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.12 }}
                  className={`relative rounded-2xl p-8 flex flex-col ${
                    highlight
                      ? "bg-gradient-to-b from-[#6c63ff]/20 to-[#3ecfcf]/5 border-2 border-[#6c63ff] glow-purple"
                      : "bg-[#111827]/60 border border-white/8"
                  }`}
                >
                  {badge && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white text-[10px] font-bold px-4 py-1 rounded-full tracking-widest whitespace-nowrap">
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

                  <Link
                    href={href}
                    className={`block text-center py-3 rounded-xl font-semibold text-sm transition ${
                      highlight
                        ? "bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white hover:opacity-90"
                        : "border border-white/20 text-white hover:bg-white/5"
                    }`}
                  >
                    {cta}
                  </Link>
                </motion.div>
              ))}
            </div>

            {/* ── How pay-per-event pricing works ── */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="max-w-4xl mx-auto"
            >
              <div className="bg-[#111827]/60 border border-white/8 rounded-2xl p-8">
                <div className="text-center mb-8">
                  <p className="text-[#3ecfcf] text-xs font-semibold tracking-widest uppercase mb-2">How It Works</p>
                  <h3 className="text-2xl font-bold text-white">
                    Configure your event, see the price instantly
                  </h3>
                  <p className="text-gray-500 text-sm mt-2">
                    No subscriptions. No monthly fees. Pay only when you run an event.
                  </p>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mb-8">
                  {PRICING_FACTORS.map(({ icon, title, desc, example }, i) => (
                    <motion.div
                      key={title}
                      initial={{ opacity: 0, x: -16 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.08 }}
                      className="flex gap-4 bg-white/3 border border-white/6 rounded-xl p-4"
                    >
                      <div className="text-2xl shrink-0">{icon}</div>
                      <div>
                        <p className="text-white font-semibold text-sm mb-0.5">{title}</p>
                        <p className="text-gray-500 text-xs leading-relaxed mb-2">{desc}</p>
                        <p className="text-[#6c63ff] text-xs font-mono">{example}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* mock configurator preview */}
                <div className="bg-[#090d1a] rounded-xl p-6 border border-white/6">
                  <p className="text-xs text-gray-500 font-mono uppercase tracking-widest mb-5">
                    Live Price Preview
                  </p>

                  <div className="space-y-5 mb-6">
                    {[
                      { label: "Photos", value: "1,000 photos", pct: 40 },
                      { label: "Storage", value: "30 days", pct: 35 },
                      { label: "Guest uploads", value: "200 photos", pct: 25 },
                    ].map(({ label, value, pct }) => (
                      <div key={label}>
                        <div className="flex justify-between text-xs mb-2">
                          <span className="text-gray-400">{label}</span>
                          <span className="text-white font-medium">{value}</span>
                        </div>
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            whileInView={{ width: `${pct}%` }}
                            viewport={{ once: true }}
                            transition={{ duration: 1, delay: 0.3 }}
                            className="h-full bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] rounded-full"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-white/6">
                    <div>
                      <p className="text-gray-500 text-xs">Estimated total</p>
                      <p className="text-2xl font-bold text-white">
                        ₹<span className="text-[#3ecfcf]">—</span>
                        <span className="text-sm font-normal text-gray-500 ml-2">calculated at checkout</span>
                      </p>
                    </div>
                    <Link
                      href="/billing/create-event-order"
                      className="flex items-center gap-2 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition"
                    >
                      Build My Event
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                </div>

                <p className="text-center text-gray-600 text-xs mt-4">
                  ✓ Razorpay secured payments &nbsp;·&nbsp; ✓ Instant activation &nbsp;·&nbsp; ✓ No hidden charges
                </p>
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
        <section className="py-24 bg-[#0d1120]">
          <div className="max-w-4xl mx-auto px-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="text-4xl md:text-5xl font-bold mb-4">
                Ready to transform your{" "}
                <span className="text-gradient">photo delivery?</span>
              </h2>
              <p className="text-gray-400 mb-10 text-lg">
                Join 2,400+ photographers already using SnapFind.
                Start free — no credit card required.
              </p>
              <div className="flex flex-wrap gap-4 justify-center">
                <Link
                  href="/login?mode=register"
                  className="flex items-center gap-2 bg-gradient-to-r from-[#6c63ff] to-[#3ecfcf] text-white font-semibold px-8 py-4 rounded-xl hover:opacity-90 transition glow-purple text-sm"
                >
                  Get Started Free
                  <ArrowRight size={16} />
                </Link>
                <Link
                  href="/public-search"
                  className="flex items-center gap-2 border border-white/20 text-white font-semibold px-8 py-4 rounded-xl hover:bg-white/5 transition text-sm"
                >
                  <Search size={16} />
                  Try Guest Search
                </Link>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ═══════════════ FOOTER ═══════════════ */}
        <footer className="bg-[#060912] border-t border-white/5 py-16">
          <div className="max-w-7xl mx-auto px-6">
            <div className="grid md:grid-cols-4 gap-10 mb-12">
              <div>
                <Link href="/" className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6c63ff] to-[#3ecfcf] flex items-center justify-center">
                    <Camera size={16} className="text-white" />
                  </div>
                  <span className="font-bold text-white">
                    Snap<span className="text-[#3ecfcf]">Find</span>
                  </span>
                </Link>
                <p className="text-gray-500 text-sm leading-relaxed mb-5">
                  AI-powered event photo delivery for photographers and organisers across India.
                </p>
                <div className="flex gap-3">
                  <a href="mailto:narendradangi999@gmail.com" className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-gray-400 hover:text-white transition">
                    <Mail size={15} />
                  </a>
                </div>
              </div>

              <div>
                <p className="text-white font-semibold text-sm mb-4">Product</p>
                <ul className="space-y-3">
                  {["Features", "Pricing", "How It Works", "FAQ"].map((l) => (
                    <li key={l}>
                      <a href={`#${l.toLowerCase().replace(/ /g,"-")}`} className="text-gray-500 text-sm hover:text-white transition">
                        {l}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-white font-semibold text-sm mb-4">Account</p>
                <ul className="space-y-3">
                  {[
                    { label: "Sign In", href: "/login?mode=login" },
                    { label: "Create Account", href: "/login?mode=register" },
                    { label: "Organiser Dashboard", href: "/dashboard" },
                    { label: "Find My Photos", href: "/public-search" },
                  ].map(({ label, href }) => (
                    <li key={label}>
                      <Link href={href} className="text-gray-500 text-sm hover:text-white transition">
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-white font-semibold text-sm mb-4">Legal</p>
                <ul className="space-y-3">
                  {["Privacy Policy", "Terms of Service", "Refund Policy"].map((l) => (
                    <li key={l}>
                      <a href="#" className="text-gray-500 text-sm hover:text-white transition">
                        {l}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
              <p className="text-gray-600 text-sm">
                © {new Date().getFullYear()} {APP_CONFIG.name}. All rights reserved.
              </p>
              <p className="text-gray-600 text-sm">
                Made with ♥ for Indian event photographers
              </p>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}