import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2DModule from 'force-graph';
import ForceGraph3DModule from '3d-force-graph';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Box,
  Compass,
  ExternalLink,
  Filter,
  Layers,
  Network,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Tag,
  Trophy,
  X,
} from 'lucide-react';
import { createDataSource } from './data';
import type { GraphData, GraphNode } from './types';
import { getMediaBadgeInfo, novelPageUrl } from './novelLinks';
import { Badge } from './design-system';
import { Select } from './ui';
import './graph.css';

const ForceGraph2D = (ForceGraph2DModule as any).default || ForceGraph2DModule;
const ForceGraph3D = (ForceGraph3DModule as any).default || ForceGraph3DModule;

const NODE_COLORS: Record<string, string> = {
  novel: '#a855f7',
  light_novel: '#a855f7',
  web_novel: '#8b5cf6',
  manga: '#06b6d4',
  manhwa: '#0284c7',
  manhua: '#0891b2',
  anime: '#ec4899',
};

const GENRE_COLORS: Record<string, string> = {
  fantasy: '#a855f7',       // Violet
  action: '#ef4444',        // Crimson Red
  romance: '#ec4899',       // Rose Pink
  scifi: '#3b82f6',         // Electric Blue
  slice_of_life: '#f59e0b', // Amber Gold
  psychological: '#10b981', // Emerald Green
  other: '#94a3b8',         // Slate Grey
};

const CLUSTER_COLORS = [
  '#38bdf8', '#ec4899', '#a855f7', '#10b981',
  '#f59e0b', '#ef4444', '#6366f1', '#14b8a6',
];

const LINK_COLORS: Record<string, string> = {
  adaptation: '#38bdf8',
  prequel: '#818cf8',
  sequel: '#818cf8',
  side_story: '#c084fc',
  spin_off: '#d8b4fe',
  direct_rec: 'rgba(148, 163, 184, 0.45)',
  shared_tag: 'rgba(16, 185, 129, 0.5)',
  related: 'rgba(148, 163, 184, 0.35)',
};

type DimensionMode = '3d' | '2d';
type ColorMode = 'media_type' | 'genre' | 'popularity' | 'cluster';
type PresetMode = 'adaptations' | 'top50' | 'full' | 'subgraph';

export default function GraphPage(): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);
  const graphInstanceRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);

  // View, Dimension & Color Mode
  const [dimensionMode, setDimensionMode] = useState<DimensionMode>('3d');
  const [colorMode, setColorMode] = useState<ColorMode>('genre');
  const [preset, setPreset] = useState<PresetMode>('adaptations');
  const [selectedCluster, setSelectedCluster] = useState<number | 'all'>('all');
  const [minDegree, setMinDegree] = useState<number>(2);

  // Format Toggles
  const [includeNovels, setIncludeNovels] = useState(true);
  const [includeManga, setIncludeManga] = useState(true);
  const [includeAnime, setIncludeAnime] = useState(true);

  // Relation Toggles
  const [includeAdaptations, setIncludeAdaptations] = useState(true);
  const [includeSequels, setIncludeSequels] = useState(true);
  const [includeRecs, setIncludeRecs] = useState(true);
  const [includeTags, setIncludeTags] = useState(true);
  const [particlesEnabled, setParticlesEnabled] = useState(true);

  // Search & Drawer States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [showInsights, setShowInsights] = useState(false);
  const [focusNeighborhoodNodeId, setFocusNeighborhoodNodeId] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const selectedNodeRef = useRef<GraphNode | null>(null);
  useEffect(() => {
    selectedNodeRef.current = selectedNode;
  }, [selectedNode]);

  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Load Graph Data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    createDataSource()
      .then((source) => source.getGraphData())
      .then((data) => {
        if (cancelled) return;
        setGraphData(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Could not load relationship graph data.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Calculate Node Color based on active ColorMode
  const getNodeColor = (node: GraphNode): string => {
    if (colorMode === 'genre') {
      return GENRE_COLORS[node.genre || 'other'] || '#94a3b8';
    }
    if (colorMode === 'popularity') {
      const r = node.readers || 0;
      if (r >= 5000) return '#f59e0b'; // Gold Mega-Hit
      if (r >= 1500) return '#38bdf8'; // Cyan Popular
      if (r >= 500) return '#a855f7';  // Purple Medium
      return '#34d399';               // Emerald Niche / Gem
    }
    if (colorMode === 'cluster') {
      return CLUSTER_COLORS[(node.cluster_id || 0) % CLUSTER_COLORS.length];
    }
    return NODE_COLORS[node.media_type] || '#a855f7';
  };

  // Compute Filtered Subgraph
  const filteredData = useMemo(() => {
    if (!graphData) return { nodes: [], links: [] };

    let nodes = graphData.nodes;
    let edges = graphData.edges;

    // Degree density filter
    if (minDegree > 1 && focusNeighborhoodNodeId == null && selectedCluster === 'all' && preset !== 'full') {
      nodes = nodes.filter((n) => n.degree >= minDegree);
    }

    // Media type filter
    nodes = nodes.filter((node) => {
      const type = node.media_type;
      if (!includeNovels && ['novel', 'light_novel', 'web_novel'].includes(type)) return false;
      if (!includeManga && ['manga', 'manhwa', 'manhua'].includes(type)) return false;
      if (!includeAnime && type === 'anime') return false;
      return true;
    });

    const validNodeIds = new Set(nodes.map((n) => n.id));

    // Edge type filter
    edges = edges.filter((edge) => {
      const srcId = typeof edge.source === 'object' ? (edge.source as any).id : edge.source;
      const tgtId = typeof edge.target === 'object' ? (edge.target as any).id : edge.target;
      if (!validNodeIds.has(srcId) || !validNodeIds.has(tgtId)) return false;

      const t = edge.type;
      if (!includeAdaptations && t === 'adaptation') return false;
      if (!includeSequels && ['prequel', 'sequel', 'side_story', 'spin_off'].includes(t)) return false;
      if (!includeRecs && t === 'direct_rec') return false;
      if (!includeTags && t === 'shared_tag') return false;
      return true;
    });

    // Presets & Cluster Selection
    if (focusNeighborhoodNodeId != null) {
      const targetId = focusNeighborhoodNodeId;
      const hop1 = new Set<number>([targetId]);
      edges.forEach((e) => {
        const s = typeof e.source === 'object' ? (e.source as any).id : e.source;
        const t = typeof e.target === 'object' ? (e.target as any).id : e.target;
        if (s === targetId) hop1.add(t);
        if (t === targetId) hop1.add(s);
      });
      const hop2 = new Set<number>(hop1);
      edges.forEach((e) => {
        const s = typeof e.source === 'object' ? (e.source as any).id : e.source;
        const t = typeof e.target === 'object' ? (e.target as any).id : e.target;
        if (hop1.has(s)) hop2.add(t);
        if (hop1.has(t)) hop2.add(s);
      });
      nodes = nodes.filter((n) => hop2.has(n.id));
      edges = edges.filter((e) => {
        const s = typeof e.source === 'object' ? (e.source as any).id : e.source;
        const t = typeof e.target === 'object' ? (e.target as any).id : e.target;
        return hop2.has(s) && hop2.has(t);
      });
    } else if (selectedCluster !== 'all') {
      nodes = nodes.filter((n) => n.cluster_id === selectedCluster);
      const clusterNodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => {
        const s = typeof e.source === 'object' ? (e.source as any).id : e.source;
        const t = typeof e.target === 'object' ? (e.target as any).id : e.target;
        return clusterNodeIds.has(s) && clusterNodeIds.has(t);
      });
    } else if (preset === 'adaptations') {
      const structuralNodeIds = new Set<number>();
      edges.forEach((e) => {
        if (['adaptation', 'prequel', 'sequel', 'side_story', 'spin_off'].includes(e.type)) {
          const s = typeof e.source === 'object' ? (e.source as any).id : e.source;
          const t = typeof e.target === 'object' ? (e.target as any).id : e.target;
          structuralNodeIds.add(s);
          structuralNodeIds.add(t);
        }
      });
      nodes = nodes.filter((n) => structuralNodeIds.has(n.id));
      edges = edges.filter((e) => {
        const s = typeof e.source === 'object' ? (e.source as any).id : e.source;
        const t = typeof e.target === 'object' ? (e.target as any).id : e.target;
        return structuralNodeIds.has(s) && structuralNodeIds.has(t);
      });
    } else if (preset === 'top50') {
      const topClusterIds = new Set(graphData.clusters.slice(0, 50).map((c) => c.id));
      nodes = nodes.filter((n) => topClusterIds.has(n.cluster_id));
      const topNodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => {
        const s = typeof e.source === 'object' ? (e.source as any).id : e.source;
        const t = typeof e.target === 'object' ? (e.target as any).id : e.target;
        return topNodeIds.has(s) && topNodeIds.has(t);
      });
    }

    if (nodes.length > 2500) {
      nodes = nodes.slice(0, 2500);
      const boundedIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => {
        const s = typeof e.source === 'object' ? (e.source as any).id : e.source;
        const t = typeof e.target === 'object' ? (e.target as any).id : e.target;
        return boundedIds.has(s) && boundedIds.has(t);
      });
    }

    return {
      nodes: nodes.map((n) => ({ ...n })),
      links: edges.map((e) => ({
        source: typeof e.source === 'object' ? (e.source as any).id : e.source,
        target: typeof e.target === 'object' ? (e.target as any).id : e.target,
        type: e.type,
        weight: e.weight,
        votes: e.votes,
      })),
    };
  }, [
    graphData,
    preset,
    selectedCluster,
    minDegree,
    includeNovels,
    includeManga,
    includeAnime,
    includeAdaptations,
    includeSequels,
    includeRecs,
    includeTags,
    focusNeighborhoodNodeId,
  ]);

  // Top Connected Hub Nodes for Analytics (computed dynamically from active filtered dataset)
  const topHubNodes = useMemo(() => {
    return [...filteredData.nodes]
      .sort((a, b) => b.degree - a.degree || b.readers - a.readers)
      .slice(0, 12);
  }, [filteredData.nodes]);

  // Search Matches
  const searchResults = useMemo(() => {
    if (!graphData || searchQuery.trim().length < 2) return [];
    const needle = searchQuery.toLowerCase().trim();
    return graphData.nodes
      .filter((n) => n.title.toLowerCase().includes(needle) || (n.author && n.author.toLowerCase().includes(needle)))
      .slice(0, 10);
  }, [graphData, searchQuery]);

  // Initialize Force Graph Canvas (2D or 3D) on isolated mount container
  useEffect(() => {
    if (!mountRef.current) return;

    const elem = mountRef.current;

    if (graphInstanceRef.current) {
      try {
        (graphInstanceRef.current as any)._destructor?.();
      } catch {
        // ignore
      }
      graphInstanceRef.current = null;
    }
    elem.innerHTML = '';

    if (!filteredData.nodes.length) return;

    const width = elem.clientWidth || elem.parentElement?.clientWidth || window.innerWidth;
    const height = elem.clientHeight || elem.parentElement?.clientHeight || window.innerHeight;

    let instance: any;

    if (dimensionMode === '3d') {
      instance = ForceGraph3D()(elem)
        .width(width)
        .height(height)
        .backgroundColor('rgba(10, 10, 15, 0.95)')
        .nodeId('id')
        .nodeLabel((node: any) => `<div style="padding:6px 10px;font-family:sans-serif;font-size:12px;color:#fff;background:rgba(15,23,42,0.95);border-radius:8px;border:1px solid #334155;"><strong>${node.title}</strong><br/><small style="color:#94a3b8">${node.media_type?.toUpperCase()} · Genre: ${(node.genre || 'other').toUpperCase()} · Readers: ${(node.readers || 0).toLocaleString()} · Rating: ${node.rating || 'N/A'}</small></div>`)
        .nodeColor((node: any) => getNodeColor(node as GraphNode))
        .nodeVal((node: any) => Math.max(3, Math.min(22, Math.sqrt(node.readers || node.degree || 5))))
        .linkColor((link: any) => LINK_COLORS[link.type] || 'rgba(148, 163, 184, 0.4)')
        .linkWidth((link: any) => (['adaptation', 'sequel', 'prequel'].includes(link.type) ? 1.5 : 0.8))
        .linkDirectionalParticles((link: any) => (particlesEnabled && ['adaptation', 'sequel', 'prequel'].includes(link.type) ? 2 : 0))
        .linkDirectionalParticleSpeed(0.006)
        .linkDirectionalParticleWidth(3)
        .onNodeClick((node: any) => {
          setSelectedNode(node as GraphNode);
          const distance = 120;
          const distRatio = 1 + distance / Math.hypot(node.x || 1, node.y || 1, node.z || 1);
          instance.cameraPosition(
            { x: (node.x || 0) * distRatio, y: (node.y || 0) * distRatio, z: (node.z || 0) * distRatio },
            { x: node.x || 0, y: node.y || 0, z: node.z || 0 },
            1200
          );
        })
        .onBackgroundClick(() => setSelectedNode(null));
    } else {
      instance = ForceGraph2D()(elem)
        .width(width)
        .height(height)
        .backgroundColor('rgba(10, 10, 15, 0.95)')
        .nodeId('id')
        .nodeLabel((node: any) => `<div style="padding:4px 8px;font-family:sans-serif;font-size:12px;color:#fff;background:rgba(15,23,42,0.9);border-radius:6px;border:1px solid #334155;"><strong>${node.title}</strong><br/><small style="color:#94a3b8">${node.media_type?.toUpperCase()} · Genre: ${(node.genre || 'other').toUpperCase()} · Rating: ${node.rating || 'N/A'}</small></div>`)
        .nodeVal((node: any) => Math.max(3, Math.min(18, Math.sqrt(node.readers || node.degree || 5))))
        .nodeCanvasObject((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const radius = Math.max(4, Math.min(18, Math.sqrt(node.readers || node.degree || 5)));
          const color = getNodeColor(node as GraphNode);
          const isSelected = selectedNodeRef.current?.id === node.id;

          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + (isSelected ? 5 : 2), 0, 2 * Math.PI, false);
          ctx.fillStyle = isSelected ? 'rgba(236, 72, 153, 0.4)' : color.replace(')', ', 0.25)').replace('rgb', 'rgba');
          ctx.fill();

          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.lineWidth = isSelected ? 2.5 : 1.2;
          ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.4)';
          ctx.stroke();

          if (globalScale > 2.5 && node.cover) {
            let img = imageCacheRef.current.get(node.cover);
            if (!img) {
              img = new Image();
              img.src = node.cover;
              img.crossOrigin = 'anonymous';
              imageCacheRef.current.set(node.cover, img);
            }
            if (img.complete && img.naturalWidth > 0) {
              ctx.save();
              ctx.beginPath();
              ctx.arc(node.x, node.y, radius - 1, 0, 2 * Math.PI, false);
              ctx.clip();
              ctx.drawImage(img, node.x - radius, node.y - radius, radius * 2, radius * 2);
              ctx.restore();
            }
          }

          if (globalScale > 1.8 || isSelected) {
            const fontSize = Math.max(10 / globalScale, 2.5);
            ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const text = node.title.length > 25 ? `${node.title.slice(0, 24)}…` : node.title;
            const textWidth = ctx.measureText(text).width;
            ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
            ctx.fillRect(node.x - textWidth / 2 - 2, node.y + radius + 3, textWidth + 4, fontSize + 3);
            ctx.fillStyle = isSelected ? '#38bdf8' : '#e2e8f0';
            ctx.fillText(text, node.x, node.y + radius + 4);
          }
        })
        .linkLabel((link: any) => `<div style="padding:4px 8px;font-size:11px;color:#cbd5e1;background:#0f172a;border-radius:4px;">${link.type.replace('_', ' ').toUpperCase()}</div>`)
        .linkColor((link: any) => LINK_COLORS[link.type] || 'rgba(148, 163, 184, 0.4)')
        .linkWidth((link: any) => (['adaptation', 'sequel', 'prequel'].includes(link.type) ? 2 : 1))
        .linkDirectionalParticles((link: any) => (particlesEnabled && ['adaptation', 'sequel', 'prequel'].includes(link.type) ? 2 : 0))
        .linkDirectionalParticleSpeed(0.006)
        .linkDirectionalParticleWidth(35)
        .onNodeClick((node: any) => {
          setSelectedNode(node as GraphNode);
          instance.centerAt(node.x, node.y, 600);
          instance.zoom(3.2, 600);
        })
        .onBackgroundClick(() => setSelectedNode(null));
    }

    instance.graphData(filteredData);
    graphInstanceRef.current = instance;

    const handleResize = () => {
      if (mountRef.current && instance) {
        const parent = mountRef.current.parentElement;
        instance.width(mountRef.current.clientWidth || parent?.clientWidth || window.innerWidth);
        instance.height(mountRef.current.clientHeight || parent?.clientHeight || window.innerHeight);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (graphInstanceRef.current) {
        try {
          (graphInstanceRef.current as any)._destructor?.();
        } catch {
          // ignore
        }
        graphInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredData, dimensionMode, colorMode, particlesEnabled]);

  // Jump / Focus Search Node
  const handleSelectSearchNode = (node: GraphNode) => {
    setSelectedNode(node);
    setSearchQuery('');
    setSearchOpen(false);

    const isCurrentlyVisible = filteredData.nodes.some((n) => n.id === node.id);
    if (!isCurrentlyVisible) {
      setFocusNeighborhoodNodeId(node.id);
      setSelectedCluster('all');
    }

    window.setTimeout(() => {
      if (graphInstanceRef.current && node.x != null && node.y != null) {
        if (dimensionMode === '3d') {
          const distance = 120;
          const distRatio = 1 + distance / Math.hypot(node.x || 1, node.y || 1, (node as any).z || 1);
          graphInstanceRef.current.cameraPosition(
            { x: (node.x || 0) * distRatio, y: (node.y || 0) * distRatio, z: ((node as any).z || 0) * distRatio },
            { x: node.x || 0, y: node.y || 0, z: (node as any).z || 0 },
            1200
          );
        } else {
          graphInstanceRef.current.centerAt(node.x, node.y, 800);
          graphInstanceRef.current.zoom(3.5, 800);
        }
      }
    }, 100);
  };

  // Connected Neighbors
  const selectedNeighbors = useMemo(() => {
    if (!selectedNode || !graphData) return [];
    const targetId = selectedNode.id;
    const list: Array<{ node: GraphNode; type: string }> = [];

    graphData.edges.forEach((edge) => {
      const srcId = typeof edge.source === 'object' ? (edge.source as any).id : edge.source;
      const tgtId = typeof edge.target === 'object' ? (edge.target as any).id : edge.target;

      if (srcId === targetId) {
        const other = graphData.nodes.find((n) => n.id === tgtId);
        if (other) list.push({ node: other, type: edge.type });
      } else if (tgtId === targetId) {
        const other = graphData.nodes.find((n) => n.id === srcId);
        if (other) list.push({ node: other, type: edge.type });
      }
    });

    return list;
  }, [selectedNode, graphData]);

  // Reset Filters
  const resetAllFilters = () => {
    setPreset('adaptations');
    setSelectedCluster('all');
    setColorMode('genre');
    setMinDegree(2);
    setIncludeNovels(true);
    setIncludeManga(true);
    setIncludeAnime(true);
    setIncludeAdaptations(true);
    setIncludeSequels(true);
    setIncludeRecs(true);
    setIncludeTags(true);
    setFocusNeighborhoodNodeId(null);
    setSelectedNode(null);
    setShowInsights(false);
  };

  const togglePause = () => {
    if (!graphInstanceRef.current) return;
    if (isPaused) {
      graphInstanceRef.current.resumeAnimation();
    } else {
      graphInstanceRef.current.pauseAnimation();
    }
    setIsPaused(!isPaused);
  };

  const centerGraph = () => {
    if (graphInstanceRef.current) {
      if (dimensionMode === '3d') {
        graphInstanceRef.current.zoomToFit(1000, 50);
      } else {
        graphInstanceRef.current.zoomToFit(800, 40);
      }
    }
  };

  return (
    <div className="graph-page">
      {/* Top Toolbar */}
      <header className="graph-toolbar">
        <div className="graph-toolbar-group">
          {/* Search Box */}
          <div className="graph-search">
            <label>
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                placeholder="Search title (e.g. Solo Leveling, Oshi no Ko)…"
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchOpen(false);
                  }}
                  style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer' }}
                >
                  <X size={14} />
                </button>
              )}
            </label>

            {searchOpen && searchResults.length > 0 && (
              <div className="graph-search-dropdown">
                {searchResults.map((node) => {
                  const badge = getMediaBadgeInfo(node);
                  return (
                    <button
                      key={node.id}
                      className="graph-search-item"
                      type="button"
                      onClick={() => handleSelectSearchNode(node)}
                    >
                      {node.cover ? (
                        <img src={node.cover} alt="" loading="lazy" />
                      ) : (
                        <div className="graph-search-item-fallback">
                          <BookOpen size={16} />
                        </div>
                      )}
                      <div className="graph-search-item-info">
                        <strong>{node.title}</strong>
                        <small>
                          {badge.formatLabel} · {node.author || 'Catalog title'}
                        </small>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3D vs 2D Mode */}
          <div className="graph-toolbar-group">
            <button
              className={`graph-control-pill ${dimensionMode === '3d' ? 'active' : ''}`}
              type="button"
              onClick={() => setDimensionMode('3d')}
            >
              <Box size={14} /> 3D Galaxy
            </button>
            <button
              className={`graph-control-pill ${dimensionMode === '2d' ? 'active' : ''}`}
              type="button"
              onClick={() => setDimensionMode('2d')}
            >
              <Layers size={14} /> 2D Map
            </button>
          </div>

          {/* Base UI Select: Color Mode Selector */}
          <Select
            value={colorMode}
            onChange={(e) => setColorMode(e.target.value as ColorMode)}
          >
            <option value="genre">Color: Tag & Genre Family</option>
            <option value="media_type">Color: Media Type (Novel/Manga/Anime)</option>
            <option value="popularity">Color: Popularity & Reader Tier</option>
            <option value="cluster">Color: Franchise Cluster Palette</option>
          </Select>

          {/* Base UI Select: Preset Selector */}
          <Select
            value={focusNeighborhoodNodeId != null ? 'subgraph' : preset}
            onChange={(e) => {
              setFocusNeighborhoodNodeId(null);
              setPreset(e.target.value as PresetMode);
              setSelectedCluster('all');
            }}
          >
            <option value="adaptations">Franchise & Adaptations</option>
            <option value="top50">Top 50 Major Franchises</option>
            <option value="full">Full Network Web</option>
            {focusNeighborhoodNodeId != null && <option value="subgraph">Focused Neighborhood</option>}
          </Select>
        </div>

        <div className="graph-toolbar-group">
          {/* Analytics Drawer Toggle */}
          <button
            className={`graph-control-pill ${showInsights ? 'active' : ''}`}
            type="button"
            onClick={() => setShowInsights(!showInsights)}
          >
            <BarChart3 size={14} /> Analytics
          </button>

          {/* Format Toggles */}
          <button
            className={`graph-control-pill ${includeNovels ? 'active' : ''}`}
            type="button"
            onClick={() => setIncludeNovels(!includeNovels)}
          >
            Novels
          </button>
          <button
            className={`graph-control-pill ${includeManga ? 'active' : ''}`}
            type="button"
            onClick={() => setIncludeManga(!includeManga)}
          >
            Manga
          </button>
          <button
            className={`graph-control-pill ${includeAnime ? 'active' : ''}`}
            type="button"
            onClick={() => setIncludeAnime(!includeAnime)}
          >
            Anime
          </button>

          {/* Relation Toggles */}
          <button
            className={`graph-control-pill ${includeAdaptations ? 'active' : ''}`}
            type="button"
            onClick={() => setIncludeAdaptations(!includeAdaptations)}
          >
            Adaptations
          </button>
          <button
            className={`graph-control-pill ${includeTags ? 'active' : ''}`}
            type="button"
            onClick={() => setIncludeTags(!includeTags)}
          >
            <Tag size={12} /> Tropes
          </button>
          <button
            className={`graph-control-pill ${particlesEnabled ? 'active' : ''}`}
            type="button"
            onClick={() => setParticlesEnabled(!particlesEnabled)}
          >
            Flow
          </button>

          {/* Control Buttons */}
          <button className="graph-control-pill" type="button" title="Center Graph" onClick={centerGraph}>
            <Compass size={14} /> Center
          </button>
          <button
            className="graph-control-pill"
            type="button"
            title={isPaused ? 'Resume Physics' : 'Pause Physics'}
            onClick={togglePause}
          >
            {isPaused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button className="graph-control-pill" type="button" title="Reset Filters" onClick={resetAllFilters}>
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      </header>

      {/* Main Canvas Container */}
      <div className="graph-canvas-container">
        {/* Dedicated mount node for Three.js / Canvas - ZERO React children inside */}
        <div className="graph-mount" ref={mountRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />

        {loading && (
          <div className="graph-overlay">
            <div className="graph-spinner" />
            <p>Building 3D visual relationship galaxy…</p>
          </div>
        )}

        {error && (
          <div className="graph-overlay">
            <Network size={36} style={{ color: 'var(--accent-bright)' }} />
            <h3>Could Not Load Relationship Graph</h3>
            <p>{error}</p>
            <button className="graph-control-pill active" type="button" onClick={() => window.location.reload()}>
              Retry Loading
            </button>
          </div>
        )}

        {!loading && !error && filteredData.nodes.length === 0 && (
          <div className="graph-overlay">
            <Filter size={36} style={{ color: 'var(--dim)' }} />
            <h3>No Titles Match Active Filters</h3>
            <p>Try enabling additional format toggles or reset the active filter settings.</p>
            <button className="graph-control-pill active" type="button" onClick={resetAllFilters}>
              Reset Filters
            </button>
          </div>
        )}

        {/* Legend Overlay with Interactive Filter Toggles */}
        {graphData && (
          <div className="graph-meta-overlay">
            <div className="graph-meta-stats">
              <span>
                <strong>{filteredData.nodes.length.toLocaleString()}</strong> titles
              </span>
              <span>
                <strong>{filteredData.links.length.toLocaleString()}</strong> connections
              </span>
              <span>Mode: <strong>{dimensionMode.toUpperCase()}</strong></span>
            </div>
            <div className="graph-legend">
              {colorMode === 'genre' && (
                <>
                  <span className="graph-legend-item">
                    <span className="graph-legend-dot" style={{ background: '#a855f7', color: '#a855f7' }} /> Fantasy / Isekai
                  </span>
                  <span className="graph-legend-item">
                    <span className="graph-legend-dot" style={{ background: '#ef4444', color: '#ef4444' }} /> Action / System
                  </span>
                  <span className="graph-legend-item">
                    <span className="graph-legend-dot" style={{ background: '#ec4899', color: '#ec4899' }} /> Romance / Drama
                  </span>
                  <span className="graph-legend-item">
                    <span className="graph-legend-dot" style={{ background: '#3b82f6', color: '#3b82f6' }} /> Sci-Fi / Cyberpunk
                  </span>
                  <span className="graph-legend-item">
                    <span className="graph-legend-dot" style={{ background: '#f59e0b', color: '#f59e0b' }} /> Slice of Life / Comedy
                  </span>
                  <span className="graph-legend-item">
                    <span className="graph-legend-dot" style={{ background: '#10b981', color: '#10b981' }} /> Psychological / Mystery
                  </span>
                </>
              )}
              {colorMode === 'media_type' && (
                <>
                  <button
                    className={`graph-legend-button ${!includeNovels ? 'inactive' : ''}`}
                    type="button"
                    onClick={() => setIncludeNovels(!includeNovels)}
                  >
                    <span className="graph-legend-dot novel" /> Light Novels
                  </button>
                  <button
                    className={`graph-legend-button ${!includeManga ? 'inactive' : ''}`}
                    type="button"
                    onClick={() => setIncludeManga(!includeManga)}
                  >
                    <span className="graph-legend-dot manga" /> Manga
                  </button>
                  <button
                    className={`graph-legend-button ${!includeAnime ? 'inactive' : ''}`}
                    type="button"
                    onClick={() => setIncludeAnime(!includeAnime)}
                  >
                    <span className="graph-legend-dot anime" /> Anime
                  </button>
                </>
              )}
              {colorMode === 'popularity' && (
                <>
                  <span className="graph-legend-item">
                    <span className="graph-legend-dot tier-s" /> Mega-Hits (&ge;5k)
                  </span>
                  <span className="graph-legend-item">
                    <span className="graph-legend-dot tier-a" /> Popular (&ge;1.5k)
                  </span>
                  <span className="graph-legend-item">
                    <span className="graph-legend-dot tier-b" /> Medium (&ge;500)
                  </span>
                  <span className="graph-legend-item">
                    <span className="graph-legend-dot tier-c" /> Gems (&lt;500)
                  </span>
                </>
              )}
              {colorMode === 'cluster' && (
                <span className="graph-legend-item">
                  <Palette size={12} /> Color-Coded Franchise Constellations
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Graph Insights & Analytics Drawer */}
      {showInsights && graphData && (
        <aside className="graph-insights-modal">
          <header className="graph-insights-header">
            <h3>
              <BarChart3 size={16} /> Graph Analytics & Insights
            </h3>
            <button
              className="graph-inspector-close"
              type="button"
              aria-label="Close insights"
              onClick={() => setShowInsights(false)}
            >
              <X size={16} />
            </button>
          </header>

          <div className="graph-insights-body">
            <div className="graph-insights-grid">
              <div className="graph-insights-card">
                <strong>{filteredData.nodes.length.toLocaleString()}</strong>
                <small>Active Filtered Titles</small>
              </div>
              <div className="graph-insights-card">
                <strong>{filteredData.links.length.toLocaleString()}</strong>
                <small>Active Connections</small>
              </div>
              <div className="graph-insights-card">
                <strong>{graphData.node_count.toLocaleString()}</strong>
                <small>Total Catalog</small>
              </div>
              <div className="graph-insights-card">
                <strong>{graphData.cluster_count.toLocaleString()}</strong>
                <small>Franchise Constellations</small>
              </div>
            </div>

            {/* Top Connected Hub Titles for Active Filter */}
            <div className="graph-insights-section">
              <h4>
                <Trophy size={14} style={{ color: 'var(--accent-bright)' }} /> Top Connected Network Hubs (Active Filter)
              </h4>
              <div className="graph-hub-list">
                {topHubNodes.map((hub) => (
                  <button
                    key={hub.id}
                    type="button"
                    className="graph-hub-item"
                    onClick={() => {
                      handleSelectSearchNode(hub);
                      setShowInsights(false);
                    }}
                  >
                    <div className="graph-hub-item-info">
                      <strong>{hub.title}</strong>
                      <small>
                        {hub.media_type.toUpperCase()} · {(hub.genre || 'other').toUpperCase()} · {hub.degree} connections · {(hub.readers || 0).toLocaleString()} readers
                      </small>
                    </div>
                    <ArrowRight size={14} style={{ color: 'var(--dim)' }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Selected Node Inspector Panel */}
      {selectedNode && (
        <aside className="graph-inspector">
          <header className="graph-inspector-header">
            <h3>Title Inspector</h3>
            <button
              className="graph-inspector-close"
              type="button"
              aria-label="Close inspector"
              onClick={() => setSelectedNode(null)}
            >
              <X size={16} />
            </button>
          </header>

          <div className="graph-inspector-body">
            <div className="graph-inspector-card">
              {selectedNode.cover ? (
                <img src={selectedNode.cover} alt="" className="graph-inspector-cover" />
              ) : (
                <div className="graph-inspector-cover" style={{ display: 'grid', placeItems: 'center' }}>
                  <BookOpen size={24} style={{ color: 'var(--dim)' }} />
                </div>
              )}
              <div className="graph-inspector-meta">
                <h2>{selectedNode.title}</h2>
                <div className="graph-inspector-author">{selectedNode.author || 'Author info unavailable'}</div>
                <div className="graph-inspector-badges">
                  <Badge tone="violet">{selectedNode.media_type.toUpperCase()}</Badge>
                  {selectedNode.genre && <Badge tone="blue">{(selectedNode.genre).toUpperCase()}</Badge>}
                  {selectedNode.rating > 0 && <Badge tone="amber">★ {selectedNode.rating.toFixed(1)}</Badge>}
                  {selectedNode.readers > 0 && <Badge tone="violet">{selectedNode.readers.toLocaleString()} readers</Badge>}
                </div>
              </div>
            </div>

            <div className="graph-inspector-actions">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setFocusNeighborhoodNodeId(selectedNode.id);
                  setSelectedCluster('all');
                }}
              >
                <Network size={14} /> Focus Subgraph
              </button>

              <a href={`${import.meta.env.BASE_URL}?view=discover&seed=${selectedNode.id}`}>
                <Sparkles size={14} /> Discover Recs
              </a>

              <a href={novelPageUrl(selectedNode.id)}>
                <ExternalLink size={14} /> Title Page
              </a>
            </div>

            {/* Connected Neighbors List */}
            {selectedNeighbors.length > 0 && (
              <div className="graph-inspector-neighbors">
                <h4>Connected Franchise Titles ({selectedNeighbors.length})</h4>
                <div className="graph-neighbor-list">
                  {selectedNeighbors.map(({ node, type }) => {
                    const badge = getMediaBadgeInfo(node);
                    return (
                      <button
                        key={node.id}
                        type="button"
                        className="graph-neighbor-item"
                        onClick={() => handleSelectSearchNode(node)}
                      >
                        <div className="graph-neighbor-info">
                          <span className="graph-neighbor-title">{node.title}</span>
                          <span className="graph-neighbor-rel">
                            {type.replace('_', ' ').toUpperCase()} · {badge.formatLabel}
                          </span>
                        </div>
                        <ArrowRight size={14} style={{ color: 'var(--dim)' }} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
