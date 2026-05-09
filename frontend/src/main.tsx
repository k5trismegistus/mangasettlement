import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import AutoStoriesOutlinedIcon from '@mui/icons-material/AutoStoriesOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import CollectionsBookmarkOutlinedIcon from '@mui/icons-material/CollectionsBookmarkOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LibraryBooksOutlinedIcon from '@mui/icons-material/LibraryBooksOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import NotesOutlinedIcon from '@mui/icons-material/NotesOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SearchIcon from '@mui/icons-material/Search';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import TuneIcon from '@mui/icons-material/Tune';
import ViewCarouselOutlinedIcon from '@mui/icons-material/ViewCarouselOutlined';
import './styles.css';

type Library = {
  id: number;
  file_name: string;
  page_count: number;
  cover_thumbnail_url: string;
  tags: string[];
  is_missing: boolean;
  updated_at: number;
};

type LibraryDetail = Library & {
  sha256: string;
  memo: string;
  file_path: string;
  file_size: number;
  file_mtime: number;
  cover_page: number | null;
};

type Page = {
  page_no: number;
  entry_name: string;
  thumbnail_url: string;
  image_url: string;
  thumb_status: string;
  width: number | null;
  height: number | null;
};

type Job = {
  id: number;
  type: string;
  status: string;
  progress: number;
  message: string;
};

type ZoomState = {
  scale: number;
  x: number;
  y: number;
};

type GestureState =
  | { mode: 'none' }
  | {
      mode: 'swipe';
      startX: number;
      startY: number;
      startedAt: number;
      moved: boolean;
    }
  | {
      mode: 'pinch';
      startDistance: number;
      startMidX: number;
      startMidY: number;
      startZoom: ZoomState;
    };

function App() {
  const [route, setRoute] = useState(() => parseRoute());

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState(null, '', path);
    setRoute(parseRoute());
  };

  if (route.libraryId) {
    return <ReaderPage libraryId={route.libraryId} navigate={navigate} />;
  }
  return <HomePage navigate={navigate} />;
}

function HomePage({ navigate }: { navigate: (path: string) => void }) {
  const initialQuery = new URLSearchParams(window.location.search);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [q, setQ] = useState(initialQuery.get('q') ?? '');
  const [tag, setTag] = useState(initialQuery.get('tag') ?? '');
  const [loading, setLoading] = useState(false);
  const [refreshJob, setRefreshJob] = useState<Job | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void fetchTags().then(setTags);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (tag) params.set('tag', tag);
      const nextUrl = params.toString() ? `/?${params.toString()}` : '/';
      window.history.replaceState(null, '', nextUrl);
      void loadLibraries(q, tag, setLibraries, setLoading);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, tag]);

  useEffect(() => {
    if (!refreshJob || refreshJob.status === 'done' || refreshJob.status === 'error') return;
    const timer = window.setInterval(async () => {
      const job = await api<Job>(`/api/jobs/${refreshJob.id}`);
      setRefreshJob(job);
      if (job.status === 'done') {
        setMessage('更新完了');
        void loadLibraries(q, tag, setLibraries, setLoading);
        void fetchTags().then(setTags);
      }
      if (job.status === 'error') setMessage('更新失敗');
    }, 1000);
    return () => window.clearInterval(timer);
  }, [refreshJob, q, tag]);

  const refresh = async () => {
    setMessage('更新中...');
    try {
      const result = await api<{ job_id: number; status: string }>('/api/refresh', { method: 'POST' });
      setRefreshJob({ id: result.job_id, type: 'refresh', status: result.status, progress: 0, message: 'Queued' });
    } catch {
      setMessage('更新処理はすでに実行中です');
    }
  };

  return (
    <main className="page">
      <header className="topHeader">
        <h1>Manga Settlement</h1>
        {message && <span className="statusText">{message}</span>}
      </header>

      <section className="controls">
        <label className="controlField">
          <SearchIcon fontSize="small" />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="ファイル名で検索" aria-label="ファイル名で検索" />
        </label>
        <label className="controlField">
          <LocalOfferOutlinedIcon fontSize="small" />
          <select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="タグで検索">
            <option value="">すべてのタグ</option>
            {tags.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <button className="primaryButton" onClick={refresh} disabled={refreshJob?.status === 'queued' || refreshJob?.status === 'running'}>
          <RefreshIcon fontSize="small" />
          <span>リフレッシュ</span>
        </button>
      </section>

      {refreshJob && refreshJob.status !== 'done' && refreshJob.status !== 'error' && (
        <div className="jobBar">
          <span>{refreshJob.message}</span>
          <progress value={refreshJob.progress} max={100} />
        </div>
      )}

      {loading ? <p className="empty">読み込み中...</p> : null}
      {!loading && libraries.length === 0 ? <p className="empty">ライブラリがありません</p> : null}
      <section className="libraryGrid">
        {libraries.map((library) => (
          <article
            key={library.id}
            className="libraryCard"
            onClick={() => navigate(`/libraries/${library.id}`)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') navigate(`/libraries/${library.id}`);
            }}
            role="button"
            tabIndex={0}
          >
            <img src={library.cover_thumbnail_url} alt="" loading="lazy" />
            <div className="libraryCardBody">
              <h2>{library.file_name}</h2>
              <p>
                <LibraryBooksOutlinedIcon fontSize="inherit" />
                {library.page_count}ページ
              </p>
              <div className="tagList">
                {library.tags.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
              {library.is_missing && <strong className="missing">ファイルなし</strong>}
            </div>
            <ChevronRightIcon className="cardChevron" fontSize="small" />
          </article>
        ))}
      </section>
    </main>
  );
}

function ReaderPage({ libraryId, navigate }: { libraryId: number; navigate: (path: string) => void }) {
  const [library, setLibrary] = useState<LibraryDetail | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [page, setPage] = useState(1);
  const [spread, setSpread] = useState(false);
  const [binding, setBinding] = useState<'rtl' | 'ltr'>('rtl');
  const [offsetSpread, setOffsetSpread] = useState(false);
  // 読書中はビューアを広く使い、補助情報は必要な時だけ開く。
  const [activePanel, setActivePanel] = useState<'pages' | 'settings' | 'meta' | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showPageHud, setShowPageHud] = useState(false);
  const [zoom, setZoom] = useState<ZoomState>({ scale: 1, x: 0, y: 0 });
  const [dragX, setDragX] = useState(0);
  const [slideAnimating, setSlideAnimating] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [memo, setMemo] = useState('');
  const gesture = useRef<GestureState>({ mode: 'none' });
  const pageHudReady = useRef(false);

  useEffect(() => {
    void api<LibraryDetail>(`/api/libraries/${libraryId}`).then((data) => {
      setLibrary(data);
      setTagInput(data.tags.join(', '));
      setMemo(data.memo ?? '');
    });
    void api<{ pages: Page[] }>(`/api/libraries/${libraryId}/pages`).then((data) => setPages(data.pages));
  }, [libraryId]);

  const visiblePages = useMemo(() => {
    if (!spread || page === 1) return [page];
    const base = offsetSpread ? 2 : 1;
    const start = Math.max(2, page - ((page - base) % 2));
    const pair = binding === 'rtl' ? [start + 1, start] : [start, start + 1];
    return pair.filter((item) => item >= 1 && item <= pages.length);
  }, [binding, offsetSpread, page, pages.length, spread]);

  useEffect(() => {
    const links: HTMLLinkElement[] = [];
    for (let index = Math.max(1, page - 2); index <= Math.min(pages.length, page + 2); index += 1) {
      const pageData = pages[index - 1];
      if (!pageData) continue;
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = pageData.image_url;
      document.head.appendChild(link);
      links.push(link);
    }
    return () => links.forEach((link) => link.remove());
  }, [page, pages]);

  useEffect(() => {
    if (!pageHudReady.current) {
      pageHudReady.current = true;
      return;
    }

    setShowPageHud(true);
    const timer = window.setTimeout(() => setShowPageHud(false), 900);
    return () => window.clearTimeout(timer);
  }, [page]);

  const nextPage = (current: number) => Math.min(pages.length, current + (spread && current > 1 ? 2 : 1));
  const previousPage = (current: number) => Math.max(1, current - (spread && current > 2 ? 2 : 1));
  const resetViewerTransform = () => {
    setZoom({ scale: 1, x: 0, y: 0 });
    setDragX(0);
  };
  const pageForDirection = (current: number, direction: 'left' | 'right') => {
    const forward = binding === 'rtl' ? direction === 'left' : direction === 'right';
    return forward ? nextPage(current) : previousPage(current);
  };
  const movePage = (direction: 'left' | 'right') => {
    const target = pageForDirection(page, direction);
    setSlideAnimating(true);

    if (target === page) {
      setDragX(0);
      window.setTimeout(() => setSlideAnimating(false), 160);
      return;
    }

    setDragX(direction === 'left' ? -window.innerWidth : window.innerWidth);
    window.setTimeout(() => {
      setPage(target);
      setSlideAnimating(false);
      resetViewerTransform();
    }, 180);
  };
  const handleViewerTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (event.touches.length === 2) {
      event.preventDefault();
      const mid = touchMidpoint(event.touches[0], event.touches[1]);
      gesture.current = {
        mode: 'pinch',
        startDistance: touchDistance(event.touches[0], event.touches[1]),
        startMidX: mid.x,
        startMidY: mid.y,
        startZoom: zoom
      };
      setSlideAnimating(false);
      return;
    }

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      gesture.current = {
        mode: 'swipe',
        startX: touch.clientX,
        startY: touch.clientY,
        startedAt: Date.now(),
        moved: false
      };
      setSlideAnimating(false);
    }
  };
  const handleViewerTouchMove = (event: React.TouchEvent<HTMLElement>) => {
    if (gesture.current.mode === 'pinch' && event.touches.length === 2) {
      event.preventDefault();
      const mid = touchMidpoint(event.touches[0], event.touches[1]);
      const scale = clampNumber((touchDistance(event.touches[0], event.touches[1]) / gesture.current.startDistance) * gesture.current.startZoom.scale, 1, 4);
      setZoom({
        scale,
        x: scale > 1.01 ? gesture.current.startZoom.x + mid.x - gesture.current.startMidX : 0,
        y: scale > 1.01 ? gesture.current.startZoom.y + mid.y - gesture.current.startMidY : 0
      });
      return;
    }

    if (gesture.current.mode === 'swipe' && event.touches.length === 1) {
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.current.startX;
      const dy = touch.clientY - gesture.current.startY;
      if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
        event.preventDefault();
        gesture.current = { ...gesture.current, moved: true };
        setDragX(dx);
      }
    }
  };
  const handleViewerTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    if (gesture.current.mode === 'pinch') {
      gesture.current = { mode: 'none' };
      return;
    }

    if (gesture.current.mode !== 'swipe') return;

    const touch = event.changedTouches[0];
    const dx = touch.clientX - gesture.current.startX;
    const dy = touch.clientY - gesture.current.startY;
    const isTap = Date.now() - gesture.current.startedAt < 220 && Math.abs(dx) < 10 && Math.abs(dy) < 10;

    if (isTap) {
      handleViewerTap(touch.clientX);
      gesture.current = { mode: 'none' };
      return;
    }

    const threshold = Math.min(120, window.innerWidth * 0.24);
    if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy)) {
      movePage(dx < 0 ? 'left' : 'right');
    } else {
      setSlideAnimating(true);
      setDragX(0);
      window.setTimeout(() => setSlideAnimating(false), 160);
    }
    gesture.current = { mode: 'none' };
  };
  const handleViewerTap = (clientX: number) => {
    const width = window.innerWidth;
    if (clientX < width * 0.28) {
      movePage('right');
      return;
    }
    if (clientX > width * 0.72) {
      movePage('left');
      return;
    }
    setControlsVisible((visible) => {
      if (visible) setActivePanel(null);
      return !visible;
    });
  };

  const saveTags = async () => {
    const tags = tagInput.split(',').map((item) => item.trim()).filter(Boolean);
    const result = await api<{ tags: string[] }>(`/api/libraries/${libraryId}/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags })
    });
    setLibrary((current) => (current ? { ...current, tags: result.tags } : current));
  };

  const saveMemo = async () => {
    const result = await api<{ memo: string }>(`/api/libraries/${libraryId}/memo`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memo })
    });
    setMemo(result.memo);
  };

  if (!library) return <main className="page"><p className="empty">読み込み中...</p></main>;
  if (library.is_missing) {
    return (
      <main className="page">
        <p className="empty">zipファイルが見つかりません</p>
        <button onClick={() => navigate('/')}>トップへ戻る</button>
      </main>
    );
  }

  return (
    <main className={`reader ${controlsVisible ? '' : 'controlsHidden'}`}>
      <nav className="readerTopBar">
        <button className="topReaderButton" onClick={() => navigate('/')} aria-label="戻る">
          <ArrowBackIosNewIcon fontSize="small" />
          <span>戻る</span>
        </button>
        <span className="readerTitle">{library.file_name}</span>
        <button className="topReaderButton iconOnly" onClick={() => setActivePanel((value) => (value === 'meta' ? null : 'meta'))} aria-label="情報">
          <InfoOutlinedIcon fontSize="small" />
        </button>
      </nav>

      <section
        className={`viewer ${spread && page !== 1 ? 'spread' : ''}`}
        onTouchStart={handleViewerTouchStart}
        onTouchMove={handleViewerTouchMove}
        onTouchEnd={handleViewerTouchEnd}
        onTouchCancel={() => {
          gesture.current = { mode: 'none' };
          setSlideAnimating(true);
          setDragX(0);
          window.setTimeout(() => setSlideAnimating(false), 160);
        }}
      >
        <div
          className={`viewerSurface ${slideAnimating ? 'animating' : ''}`}
          style={{ transform: `translate3d(${dragX}px, 0, 0)` }}
        >
          <div
            className="imageTransform"
            style={{ transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})` }}
          >
            {visiblePages.map((pageNo) => {
              const pageData = pages[pageNo - 1];
              return pageData ? <img key={pageNo} src={pageData.image_url} alt={`${pageNo}ページ`} draggable={false} /> : null;
            })}
          </div>
        </div>
      </section>

      {showPageHud && <div className="pageHud">{page} / {pages.length}</div>}

      <nav className="readerBar">
        <button className="readerAction" onClick={() => setActivePanel((value) => (value === 'settings' ? null : 'settings'))}>
          <TuneIcon fontSize="small" />
          <span>表示</span>
        </button>
        <button className="readerAction" onClick={() => setActivePanel((value) => (value === 'pages' ? null : 'pages'))}>
          <CollectionsBookmarkOutlinedIcon fontSize="small" />
          <span>ページ</span>
        </button>
      </nav>

      {activePanel && (
        <section className={`readerPanel ${activePanel === 'meta' ? 'metaOpen' : ''} ${activePanel === 'pages' ? 'pagesOpen' : ''}`}>
          <header className="readerPanelHeader">
            <h2>{panelTitle(activePanel)}</h2>
            <button onClick={() => setActivePanel(null)} aria-label="閉じる">
              <CloseIcon fontSize="small" />
            </button>
          </header>

          {activePanel === 'pages' && (
            <div className="thumbStrip">
              {pages.map((item) => (
                <button
                  key={item.page_no}
                  className={item.page_no === page ? 'active' : ''}
                  onClick={() => {
                    setPage(item.page_no);
                    resetViewerTransform();
                    setActivePanel(null);
                  }}
                >
                  <img src={item.thumbnail_url} alt={`${item.page_no}ページ`} loading="lazy" />
                  <span>{item.page_no}</span>
                </button>
              ))}
            </div>
          )}

          {activePanel === 'settings' && (
            <div className="settingsPanel">
              <section>
                <h3>表示</h3>
                <div className="segmentedControl">
                  <button className={!spread ? 'active' : ''} onClick={() => {
                    setSpread(false);
                    resetViewerTransform();
                  }}>
                    <AutoStoriesOutlinedIcon fontSize="small" />
                    <span>1ページ</span>
                  </button>
                  <button className={spread ? 'active' : ''} onClick={() => {
                    setSpread(true);
                    resetViewerTransform();
                  }}>
                    <ViewCarouselOutlinedIcon fontSize="small" />
                    <span>見開き</span>
                  </button>
                </div>
              </section>

              {spread && (
                <section>
                  <h3>見開き設定</h3>
                  <div className="segmentedControl">
                    <button className={binding === 'rtl' ? 'active' : ''} onClick={() => {
                      setBinding('rtl');
                      resetViewerTransform();
                    }}>
                      <SwapHorizIcon fontSize="small" />
                      <span>右綴じ</span>
                    </button>
                    <button className={binding === 'ltr' ? 'active' : ''} onClick={() => {
                      setBinding('ltr');
                      resetViewerTransform();
                    }}>
                      <SwapHorizIcon fontSize="small" />
                      <span>左綴じ</span>
                    </button>
                  </div>
                  <button className={`settingRow ${offsetSpread ? 'active' : ''}`} onClick={() => {
                    setOffsetSpread((value) => !value);
                    resetViewerTransform();
                  }}>
                    <TuneIcon fontSize="small" />
                    <span>見開き開始位置を1ページずらす</span>
                  </button>
                </section>
              )}
            </div>
          )}

          {activePanel === 'meta' && (
            <div className="metaPanel">
              <h1>{library.file_name}</h1>
              <label>
                <span><LocalOfferOutlinedIcon fontSize="small" />タグ</span>
                <input value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="tag1, tag2" />
              </label>
              <button onClick={saveTags}>
                <SaveOutlinedIcon fontSize="small" />
                <span>タグ保存</span>
              </button>
              <label>
                <span><NotesOutlinedIcon fontSize="small" />メモ</span>
                <textarea value={memo} onChange={(event) => setMemo(event.target.value)} />
              </label>
              <button onClick={saveMemo}>
                <ArticleOutlinedIcon fontSize="small" />
                <span>メモ保存</span>
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

async function loadLibraries(q: string, tag: string, setLibraries: (items: Library[]) => void, setLoading: (loading: boolean) => void) {
  setLoading(true);
  try {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tag) params.set('tag', tag);
    const data = await api<{ items: Library[] }>(`/api/libraries?${params.toString()}`);
    setLibraries(data.items);
  } finally {
    setLoading(false);
  }
}

async function fetchTags(): Promise<string[]> {
  const data = await api<{ tags: string[] }>('/api/tags');
  return data.tags;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(response.statusText);
  return response.json() as Promise<T>;
}

function parseRoute(): { libraryId?: number } {
  const match = window.location.pathname.match(/^\/libraries\/(\d+)/);
  return match ? { libraryId: Number(match[1]) } : {};
}

function panelTitle(panel: 'pages' | 'settings' | 'meta'): string {
  if (panel === 'pages') return 'ページ';
  if (panel === 'settings') return '表示設定';
  return '情報';
}

function touchDistance(a: React.Touch, b: React.Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchMidpoint(a: React.Touch, b: React.Touch): { x: number; y: number } {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

createRoot(document.getElementById('root')!).render(<App />);
