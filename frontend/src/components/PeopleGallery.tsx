"use client";

/**
 * PeopleGallery.tsx
 * Drop-in replacement for the Clusters accordion tab.
 *
 * USAGE in page.tsx — replace the entire {view === "clusters" && (...)} block with:
 *   {view === "clusters" && (
 *     <PeopleGallery
 *       clusters={clusters}
 *       clustersMeta={clustersMeta}
 *       clustersLoading={clustersLoading}
 *       clustersLoadingMore={clustersLoadingMore}
 *       scenes={scenes}
 *       isFree={isFree}
 *       thumbUrl={thumbUrl}
 *       clusterDlUrl={clusterDlUrl}
 *       authH={authH}
 *       showToast={showToast}
 *       onLoadMore={() => loadClusters(clustersPage + 1)}
 *       sentinelRef={clusterSentinelRef}
 *     />
 *   )}
 *
 * ADD to page.tsx imports:
 *   import PeopleGallery from "@/components/PeopleGallery";
 *   (or wherever you place this file)
 */

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download, Loader2, Lock, X, ZoomIn, ChevronLeft, ChevronRight,
  Users, Search, Filter,
} from "lucide-react";

// ─── Types (mirror page.tsx) ─────────────────────────────────────────────────

interface ClusterItem {
  cluster_id: number;
  image_count: number;
  preview_image: string;
  images: string[];
  scene_label?: string;
}

interface ClustersMeta {
  total_clusters: number;
  total_images: number;
  has_more: boolean;
}

interface SceneItem {
  scene_label: string;
  count: number;
}

interface Props {
  clusters: ClusterItem[];
  clustersMeta: ClustersMeta | null;
  clustersLoading: boolean;
  clustersLoadingMore: boolean;
  scenes: SceneItem[];
  isFree: boolean;
  thumbUrl: (name: string) => string;
  clusterDlUrl: (cid: number) => string;
  authH: () => { Authorization: string };
  showToast: (msg: string) => void;
  onLoadMore: () => void;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PeopleGallery({
  clusters,
  clustersMeta,
  clustersLoading,
  clustersLoadingMore,
  scenes,
  isFree,
  thumbUrl,
  clusterDlUrl,
  authH,
  showToast,
  onLoadMore,
  sentinelRef,
}: Props) {
  // ── Panel state ────────────────────────────────────────────────────────────
  const [selectedCluster, setSelectedCluster] = useState<ClusterItem | null>(null);

  // ── Filter state ───────────────────────────────────────────────────────────
  const [sceneFilter, setSceneFilter] = useState<string | null>(null);
  const [minPhotos,   setMinPhotos]   = useState<number>(1);
  const [searchQ,     setSearchQ]     = useState("");

  // ── Lightbox state (inside panel) ─────────────────────────────────────────
  const [lightboxImg,  setLightboxImg]  = useState<string | null>(null);
  const [lightboxIdx,  setLightboxIdx]  = useState(0);

  // ── Per-cluster download loading ───────────────────────────────────────────
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  // ── Filtered clusters ──────────────────────────────────────────────────────
  const filtered = clusters.filter(c => {
    if (sceneFilter && c.scene_label !== sceneFilter) return false;
    if (c.image_count < minPhotos) return false;
    return true;
  });

  // ── Download handler with loading state ───────────────────────────────────
  const handleDownload = useCallback(async (cluster: ClusterItem) => {
    if (downloadingId !== null) return;
    setDownloadingId(cluster.cluster_id);
    try {
      const res = await fetch(clusterDlUrl(cluster.cluster_id), { headers: authH() });
      if (!res.ok) { showToast("Download failed"); return; }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `cluster_${cluster.cluster_id}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast(`Downloaded ${cluster.image_count} photos`);
    } catch {
      showToast("Download failed");
    } finally {
      setDownloadingId(null);
    }
  }, [downloadingId, clusterDlUrl, authH, showToast]);

  // ── Lightbox nav ──────────────────────────────────────────────────────────
  const openLight = (img: string, idx: number) => { setLightboxImg(img); setLightboxIdx(idx); };
  const navLight  = (dir: number) => {
    if (!selectedCluster) return;
    const next = (lightboxIdx + dir + selectedCluster.images.length) % selectedCluster.images.length;
    setLightboxIdx(next);
    setLightboxImg(selectedCluster.images[next]);
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (clustersLoading) {
    return (
      <div className="flex items-center justify-center py-24 gap-3 text-zinc-500">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading people…</span>
      </div>
    );
  }

  if (!clustersMeta || clustersMeta.total_clusters === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
          <Users size={20} className="text-zinc-600" />
        </div>
        <p className="text-sm text-zinc-400">No people found</p>
        <p className="text-xs text-zinc-600">Process the event to detect and group faces</p>
      </div>
    );
  }

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold">
              {clustersMeta.total_clusters.toLocaleString()} People
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {clustersMeta.total_images.toLocaleString()} photos · click a person to browse their photos
            </p>
          </div>
          {isFree && (
            <div className="flex items-center gap-1.5 text-xs text-amber-500/80 bg-amber-500/8 border border-amber-500/20 px-3 py-1.5 rounded-lg">
              <Lock size={11} /> Upgrade to Pro to download
            </div>
          )}
        </div>

        {/* ── Filter bar ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Min photos quick filter */}
          <div className="flex gap-1">
            {[1, 5, 10, 20].map(n => (
              <button key={n}
                onClick={() => setMinPhotos(n)}
                className={`text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                  minPhotos === n
                    ? "bg-zinc-700 border-zinc-600 text-zinc-200"
                    : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:bg-zinc-800"
                }`}>
                {n === 1 ? "All" : `${n}+ photos`}
              </button>
            ))}
          </div>

          {/* Scene pills */}
          {scenes.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => setSceneFilter(null)}
                className={`text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                  sceneFilter === null
                    ? "bg-blue-500/20 border-blue-500/30 text-blue-300"
                    : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:bg-zinc-800"
                }`}>
                <Filter size={10} className="inline mr-1 -mt-0.5" />All scenes
              </button>
              {scenes.slice(0, 5).map(s => (
                <button key={s.scene_label}
                  onClick={() => setSceneFilter(sceneFilter === s.scene_label ? null : s.scene_label)}
                  className={`text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors capitalize ${
                    sceneFilter === s.scene_label
                      ? "bg-blue-500/20 border-blue-500/30 text-blue-300"
                      : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:bg-zinc-800"
                  }`}>
                  {s.scene_label}
                  <span className="ml-1 opacity-40">{s.count}</span>
                </button>
              ))}
            </div>
          )}

          <span className="text-xs text-zinc-600 ml-auto">
            {filtered.length} of {clusters.length} shown
          </span>
        </div>
      </div>

      {/* ── People Grid ────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <p className="text-sm text-zinc-400">No people match the filter</p>
          <button onClick={() => { setSceneFilter(null); setMinPhotos(1); }}
            className="text-xs text-blue-400 hover:underline">Clear filters</button>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
          {filtered.map((cluster, idx) => (
            <motion.div
              key={cluster.cluster_id}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: Math.min(idx * 0.015, 0.4), duration: 0.2 }}
              onClick={() => setSelectedCluster(cluster)}
              className="group relative cursor-pointer flex flex-col items-center gap-2 p-2 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/60 transition-all"
            >
              {/* Face avatar — circular crop */}
              <div className="relative w-full aspect-square rounded-xl overflow-hidden border-2 border-zinc-700 group-hover:border-zinc-500 transition-colors">
                <img
                  src={thumbUrl(cluster.preview_image)}
                  className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                  onError={e => {
                    (e.target as HTMLImageElement).src =
                      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='%2327272a'/%3E%3C/svg%3E";
                  }}
                />
                {/* Photo count badge */}
                <div className="absolute bottom-1 right-1 bg-black/70 backdrop-blur-sm text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-md leading-none">
                  {cluster.image_count}
                </div>
              </div>

              {/* Scene label */}
              {cluster.scene_label && (
                <span className="text-[9px] text-zinc-500 capitalize truncate w-full text-center">
                  {cluster.scene_label}
                </span>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* ── Infinite scroll sentinel ─────────────────────────────────────── */}
      <div ref={sentinelRef} className="h-1 mt-4" />
      {clustersLoadingMore && (
        <div className="flex items-center justify-center py-4 gap-2 text-zinc-500">
          <Loader2 size={14} className="animate-spin" />
          <span className="text-xs">Loading more…</span>
        </div>
      )}

      {/* ── Person slide-over panel ────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedCluster && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => setSelectedCluster(null)}
            />

            {/* Panel */}
            <motion.div
              initial={{ x: "100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="fixed inset-y-0 right-0 w-full max-w-lg bg-zinc-950 border-l border-zinc-800 z-50 flex flex-col shadow-2xl"
            >
              {/* Panel header */}
              <div className="flex items-center justify-between px-5 py-12 border-b border-zinc-800 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <img
                    src={thumbUrl(selectedCluster.preview_image)}
                    className="w-9 h-9 rounded-xl object-cover border border-zinc-700"
                  />
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">
                      Person #{selectedCluster.cluster_id}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {selectedCluster.image_count} photo{selectedCluster.image_count !== 1 ? "s" : ""}
                      {selectedCluster.scene_label && (
                        <span className="ml-2 capitalize text-zinc-600">{selectedCluster.scene_label}</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Download button with per-cluster loading */}
                  {isFree ? (
                    <div title="Upgrade to Pro to download"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-600 cursor-not-allowed text-xs">
                      <Lock size={12} /> Download
                    </div>
                  ) : (
                    <button
                      onClick={() => handleDownload(selectedCluster)}
                      disabled={downloadingId !== null}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        downloadingId === selectedCluster.cluster_id
                          ? "bg-blue-600/50 border border-blue-500/30 text-blue-300 cursor-wait"
                          : "bg-blue-600 hover:bg-blue-500 text-white border border-blue-500"
                      }`}
                    >
                      {downloadingId === selectedCluster.cluster_id ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          Preparing ZIP…
                        </>
                      ) : (
                        <>
                          <Download size={12} />
                          Download ZIP
                        </>
                      )}
                    </button>
                  )}

                  <button onClick={() => setSelectedCluster(null)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Photo grid inside panel */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4">
                {/* Download progress overlay — shown when downloading */}
                <AnimatePresence>
                  {downloadingId === selectedCluster.cluster_id && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="flex items-center gap-3 mb-4 px-4 py-3 bg-blue-500/10 border border-blue-500/20 rounded-xl"
                    >
                      <Loader2 size={14} className="animate-spin text-blue-400 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-blue-300">Creating ZIP…</p>
                        <p className="text-[11px] text-blue-400/60">
                          Packaging {selectedCluster.image_count} photos, this may take a moment
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="grid grid-cols-3 gap-2">
                  {selectedCluster.images.map((img, i) => (
                    <motion.div
                      key={img}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: Math.min(i * 0.012, 0.3) }}
                      className="group relative rounded-xl overflow-hidden border border-zinc-800 hover:border-zinc-600 cursor-pointer aspect-[4/5] bg-zinc-800 transition-all hover:scale-[1.02]"
                      onClick={() => openLight(img, i)}
                    >
                      <img
                        src={thumbUrl(img)}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="w-8 h-8 rounded-lg bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center text-white">
                          <ZoomIn size={13} />
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Lightbox ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {lightboxImg && selectedCluster && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/95 z-[60] flex items-center justify-center p-4"
            onClick={() => setLightboxImg(null)}
          >
            <button
              onClick={e => { e.stopPropagation(); navLight(-1); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 backdrop-blur border border-white/15 flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10"
            >
              <ChevronLeft size={18} />
            </button>

            <motion.img
              key={lightboxImg}
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              src={thumbUrl(lightboxImg)}
              className="max-h-[88vh] max-w-[88vw] rounded-xl object-contain shadow-2xl"
              onClick={e => e.stopPropagation()}
            />

            <button
              onClick={e => { e.stopPropagation(); navLight(1); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 backdrop-blur border border-white/15 flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10"
            >
              <ChevronRight size={18} />
            </button>

            <button
              onClick={() => setLightboxImg(null)}
              className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 backdrop-blur border border-white/15 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
            >
              <X size={16} />
            </button>

            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-zinc-500">
              {lightboxIdx + 1} / {selectedCluster.images.length}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}