"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useSwipeable } from "react-swipeable";

const PAGE_SIZE = 12;

export default function PublicSelfiePage() {
  const params = useParams();
  const token = params?.token as string;

  const API = process.env.NEXT_PUBLIC_API_URL;

  const [event, setEvent] = useState<any>(null);
  const [results, setResults] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"you" | "friends">("you");
  const [selectedCluster, setSelectedCluster] = useState<any>(null);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loaderRef = useRef<HTMLDivElement>(null);

  // Load Event
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/public/events/${token}`)
      .then(res => res.json())
      .then(data => setEvent(data));
  }, [token]);

  // Infinite Scroll
  const handleObserver = useCallback((entries: any) => {
    if (entries[0].isIntersecting) {
      setVisibleCount(prev => prev + PAGE_SIZE);
    }
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(handleObserver, {
      root: null,
      rootMargin: "20px",
      threshold: 0.5
    });
    if (loaderRef.current) observer.observe(loaderRef.current);
  }, [handleObserver]);

  const handleUpload = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(
      `${API}/public/events/${token}/search`,
      { method: "POST", body: formData }
    );

    const data = await res.json();
    setResults(data);
  };

  const images =
    activeTab === "you"
      ? results?.matched_photos?.map((p: any) => p.image_name)
      : selectedCluster?.images;

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () =>
      setGalleryIndex(prev =>
        prev !== null && images && prev < images.length - 1
          ? prev + 1
          : prev
      ),
    onSwipedRight: () =>
      setGalleryIndex(prev =>
        prev !== null && prev > 0 ? prev - 1 : prev
      )
  });

  const downloadCluster = () => {
    if (!selectedCluster) return;
    selectedCluster.images.forEach((img: string) => {
      const link = document.createElement("a");
      link.href = `${API}/public/events/${token}/image/${img}`;
      link.download = img;
      link.click();
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 to-white p-6 flex justify-center">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-xl p-6 space-y-6">

        <h1 className="text-xl font-semibold text-center">
          {event?.event_name}
        </h1>

        <input
          type="file"
          accept="image/*"
          onChange={(e) =>
            e.target.files?.[0] && handleUpload(e.target.files[0])
          }
          className="w-full border rounded-xl p-3"
        />

        {results && (
          <>
            {/* Tabs */}
            <div className="flex rounded-xl overflow-hidden text-sm">
              <button
                onClick={() => {
                  setActiveTab("you");
                  setSelectedCluster(null);
                }}
                className={`flex-1 py-2 transition ${
                  activeTab === "you"
                    ? "bg-blue-500 text-white"
                    : "bg-purple-100 text-purple-700"
                }`}
              >
                Your Photos
              </button>

              <button
                onClick={() => setActiveTab("friends")}
                className={`flex-1 py-2 transition ${
                  activeTab === "friends"
                    ? "bg-blue-500 text-white"
                    : "bg-purple-100 text-purple-700"
                }`}
              >
                With Friends
              </button>
            </div>

            {/* Friends Cluster List */}
            {activeTab === "friends" && (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {results.friends_clusters?.map((cluster: any) => (
                  <div
                    key={cluster.cluster_id}
                    onClick={() => {
                      setSelectedCluster(cluster);
                      setVisibleCount(PAGE_SIZE);
                    }}
                    className="min-w-[90px] cursor-pointer rounded-xl border p-2 text-center hover:shadow-md transition"
                  >
                    <img
                      src={`${API}/public/events/${token}/thumbnail/${cluster.images[0]}`}
                      className="rounded-lg mb-1"
                      loading="lazy"
                    />
                    <div className="text-xs font-medium">
                      {cluster.images.length} Photos
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tailwind Masonry Layout */}
            {images && (
              <div className="columns-2 gap-3">
                {images.slice(0, visibleCount).map((img: string, index: number) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className="mb-3 break-inside-avoid cursor-pointer group relative"
                    onClick={() => setGalleryIndex(index)}
                  >
                    <img
                      src={`${API}/public/events/${token}/image/${img}`}
                      className="rounded-xl shadow w-full"
                      loading="lazy"
                    />

                    {/* Face highlight hover */}
                    <div className="absolute inset-0 border-2 border-transparent group-hover:border-blue-500 rounded-xl transition-all"></div>
                  </motion.div>
                ))}
              </div>
            )}

            <div ref={loaderRef}></div>

            {/* Download Button */}
            {selectedCluster && (
              <button
                onClick={downloadCluster}
                className="w-full bg-blue-500 text-white py-2 rounded-xl hover:bg-blue-600 transition"
              >
                Download All
              </button>
            )}
          </>
        )}
      </div>

      {/* Swipe Gallery */}
      <AnimatePresence>
        {galleryIndex !== null && images && (
          <motion.div
            className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            {...swipeHandlers}
          >
            <img
              src={`${API}/public/events/${token}/image/${images[galleryIndex]}`}
              className="max-h-[90%] max-w-[90%] rounded-xl"
            />
            <button
              onClick={() => setGalleryIndex(null)}
              className="absolute top-4 right-4 text-white text-xl"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
