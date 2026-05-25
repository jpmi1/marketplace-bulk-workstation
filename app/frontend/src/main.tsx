import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  Bitcoin,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Github,
  ImageOff,
  Images,
  LayoutDashboard,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  Settings,
  ShipWheel,
  Target,
  Trash2,
  TrendingUp,
  Upload,
  UploadCloud,
} from "lucide-react";
import "./styles.css";

type Issue = { field: string; severity: "error" | "warning"; message: string };
type Photo = {
  id: string;
  uri: string;
  path: string;
  source_url: string;
  kind: string;
  provenance: string;
  removed: boolean;
  cover: boolean;
  sort_order: number;
  rights_warning: string;
};
type Listing = {
  id: string;
  source: string;
  title: string;
  price: number | null;
  condition: string;
  category: string;
  quantity_text: string;
  description: string;
  location: string;
  pickup_enabled: boolean;
  shipping_enabled: boolean;
  package_weight_oz: number | null;
  carrier_preference: string;
  private_notes: string;
  approved: boolean;
  status: string;
  reference_only_approved: boolean;
  validation: Issue[];
  photos: Photo[];
};
type AppSettings = {
  project_name: string;
  location: string;
  pickup_place_name: string;
  pickup_zip_code: string;
  default_condition: string;
  default_payment_terms: string;
  default_pickup_terms: string;
  shipping_enabled_default: boolean;
  default_package_weight_oz: number | null;
  carrier_preference: string;
  auto_publish: boolean;
  draft_and_confirm: boolean;
  listing_auto_refresh_enabled: boolean;
  listing_auto_refresh_interval_days: number;
  listing_auto_refresh_limit: number;
  listing_auto_refresh_last_run_at: string;
  listing_auto_refresh_last_result: string;
  batch_size: number;
  facebook_profile_path: string;
  image_research_enabled: boolean;
  comp_research_enabled: boolean;
  local_image_recognition_enabled: boolean;
  local_ocr_enabled: boolean;
  local_vision_ollama_host: string;
  local_vision_model: string;
  local_vision_model_root: string;
  reference_image_policy: string;
  description_tone: string;
  btc_goal_amount: number;
  btc_owned: number;
  manual_btc_usd_price: number;
  kraken_referral_url: string;
  google_sheet_url: string;
  progress_currency: string;
  forbidden_public_phrases: string[];
};
type LogRow = { id: number; listing_id: string | null; level: string; message: string; created_at: string };
type BtcEntry = {
  id: number;
  entry_type: string;
  title: string;
  amount_usd: number;
  btc_amount: number;
  btc_price_usd: number | null;
  listing_id: string | null;
  notes: string;
  entry_date: string;
  created_at: string;
  updated_at: string;
};
type BtcSummary = {
  goal_btc: number;
  starting_btc_owned: number;
  ledger_btc: number;
  total_btc_owned: number;
  manual_btc_usd_price: number;
  gross_proceeds_usd: number;
  spent_on_btc_usd: number;
  available_usd: number;
  estimated_purchasable_btc: number;
  projected_btc: number;
  remaining_btc: number;
  remaining_usd: number | null;
  progress_percent: number;
  entry_count: number;
  currency: string;
  google_sheet_url: string;
  kraken_referral_url: string;
  recent_entries: BtcEntry[];
};
type IntakePhoto = {
  id: string;
  name: string;
  uri: string;
  path: string;
  last_modified?: number;
  removed: boolean;
  cover: boolean;
  sort_order: number;
};
type IntakeGroup = {
  id: string;
  title: string;
  photo_ids: string[];
  removed_photo_ids: string[];
  cover_photo_id: string;
};
type IntakeBatch = {
  id: string;
  photos: IntakePhoto[];
  groups: IntakeGroup[];
  status: string;
  created_count: number;
  created_listing_ids?: string[];
};

const conditions = ["New", "Used - Like New", "Used - Good", "Used - Fair"];
const btcEntryTypes = ["sale_proceeds", "cash_set_aside", "btc_purchase", "referral_bonus", "adjustment"];
const repoUrl = "https://github.com/jpmi1/marketplace-bulk-workstation";
const facebookMarketplaceLinks = {
  createListing: "https://www.facebook.com/marketplace/create/item",
  drafts: "https://www.facebook.com/marketplace/you/selling?state=drafts",
  listings: "https://www.facebook.com/marketplace/you/selling",
};
const formatUsd = (value?: number | null) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0);
const formatBtc = (value?: number | null) => `${(value || 0).toFixed(8)} BTC`;
const photoSrc = (photo?: Photo) => {
  if (!photo) return "";
  return photo.path ? `/api/assets/photos/${encodeURIComponent(photo.id)}` : photo.uri;
};
const api = {
  async getListings(): Promise<Listing[]> {
    return fetch("/api/listings").then((res) => res.json());
  },
  async getSettings(): Promise<AppSettings> {
    return fetch("/api/settings").then((res) => res.json());
  },
  async getLogs(): Promise<LogRow[]> {
    return fetch("/api/logs").then((res) => res.json());
  },
  async getBtcEntries(): Promise<BtcEntry[]> {
    return fetch("/api/btc-progress").then((res) => res.json());
  },
  async getBtcSummary(): Promise<BtcSummary> {
    return fetch("/api/btc-progress/summary").then((res) => res.json());
  },
  async createBtcEntry(data: Partial<BtcEntry>): Promise<BtcEntry> {
    return fetch("/api/btc-progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    }).then((res) => res.json());
  },
  async deleteBtcEntry(id: number): Promise<{ deleted: number[] }> {
    return fetch(`/api/btc-progress/${encodeURIComponent(id)}`, { method: "DELETE" }).then((res) => res.json());
  },
  async importExisting(): Promise<Record<string, number>> {
    return fetch("/api/intake/existing-outputs", { method: "POST" }).then((res) => res.json());
  },
  async uploadPhotoIntake(files: File[]): Promise<IntakeBatch> {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    form.append("metadata", JSON.stringify(files.map((file) => ({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified }))));
    const response = await fetch("/api/intake/photos", { method: "POST", body: form });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
  async appendPhotoIntake(batchId: string, files: File[]): Promise<IntakeBatch> {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    form.append("metadata", JSON.stringify(files.map((file) => ({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified }))));
    const response = await fetch(`/api/intake/batches/${encodeURIComponent(batchId)}/photos`, { method: "POST", body: form });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
  async commitPhotoBatch(batchId: string, groups: IntakeGroup[]): Promise<{ batch_id: string; created: string[] }> {
    const response = await fetch(`/api/intake/photo-groups/${encodeURIComponent(batchId)}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { groups } }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
  async patchListing(id: string, data: Partial<Listing>): Promise<Listing> {
    return fetch(`/api/listings/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    }).then((res) => res.json());
  },
  async approveListing(id: string, approved: boolean): Promise<Listing> {
    return fetch(`/api/listings/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { approved } }),
    }).then((res) => res.json());
  },
  async recognizeListing(id: string): Promise<Listing> {
    const response = await fetch(`/api/listings/${encodeURIComponent(id)}/recognize`, { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
  async recognizeListings(ids: string[]): Promise<{ updated: string[]; failed: Record<string, string> }> {
    const response = await fetch("/api/listings/recognize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { ids } }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
  async patchPhoto(listingId: string, photoId: string, data: Partial<Photo>): Promise<Listing> {
    return fetch(`/api/listings/${encodeURIComponent(listingId)}/photos/${encodeURIComponent(photoId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    }).then((res) => res.json());
  },
  async patchSettings(data: Partial<AppSettings>): Promise<AppSettings> {
    return fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    }).then((res) => res.json());
  },
  async deleteListings(ids: string[]): Promise<{ deleted: string[] }> {
    return fetch("/api/listings/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { ids } }),
    }).then((res) => res.json());
  },
  async applyPickupLocation(ids: string[] = []): Promise<{ updated: string[]; location: string }> {
    const response = await fetch("/api/listings/apply-pickup-location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { ids } }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
};

function App() {
  const [view, setView] = useState<"intake" | "review" | "btc" | "agents" | "posting" | "settings" | "logs">("intake");
  const [listings, setListings] = useState<Listing[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [btcEntries, setBtcEntries] = useState<BtcEntry[]>([]);
  const [btcSummary, setBtcSummary] = useState<BtcSummary | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [checkedListingIds, setCheckedListingIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  async function loadAll() {
    const [nextListings, nextSettings, nextLogs, nextBtcEntries, nextBtcSummary] = await Promise.all([api.getListings(), api.getSettings(), api.getLogs(), api.getBtcEntries(), api.getBtcSummary()]);
    setListings(nextListings);
    setSettings(nextSettings);
    setLogs(nextLogs);
    setBtcEntries(nextBtcEntries);
    setBtcSummary(nextBtcSummary);
    setSelectedId((current) => current || nextListings[0]?.id || "");
  }

  useEffect(() => {
    loadAll();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return listings.filter((listing) => {
      const statusOk = statusFilter === "all" || listing.status === statusFilter || (statusFilter === "approved" && listing.approved);
      const queryOk = !needle || [listing.title, listing.category, listing.quantity_text, listing.source].join(" ").toLowerCase().includes(needle);
      return statusOk && queryOk;
    });
  }, [listings, query, statusFilter]);
  const selected = filtered.find((listing) => listing.id === selectedId) || filtered[0];
  const handoffIds = checkedListingIds.length ? checkedListingIds : selected?.id ? [selected.id] : [];

  async function mutateListing(id: string, data: Partial<Listing>) {
    setSaving(true);
    const updated = await api.patchListing(id, data);
    setListings((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
    setSaving(false);
    setToast("Changes saved");
    window.setTimeout(() => setToast(""), 1800);
  }

  async function mutatePhoto(listingId: string, photoId: string, data: Partial<Photo>) {
    const updated = await api.patchPhoto(listingId, photoId, data);
    setListings((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
  }

  async function approve(id: string, approved: boolean) {
    const updated = await api.approveListing(id, approved);
    setListings((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
  }

  async function recognize(ids: string[]) {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (!uniqueIds.length) return;
    setSaving(true);
    if (uniqueIds.length === 1) {
      const updated = await api.recognizeListing(uniqueIds[0]);
      setListings((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      setToast("Local recognition updated this listing");
    } else {
      const result = await api.recognizeListings(uniqueIds);
      await loadAll();
      const failed = Object.keys(result.failed || {}).length;
      setToast(`Local recognition updated ${result.updated.length}; ${failed} failed`);
    }
    setSaving(false);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function deleteListings(ids: string[]) {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (!uniqueIds.length) return;
    const label = uniqueIds.length === 1 ? "this listing" : `${uniqueIds.length} listings`;
    if (!window.confirm(`Delete ${label}? This removes it from the project and posting queue.`)) return;
    setSaving(true);
    const result = await api.deleteListings(uniqueIds);
    const deleted = new Set(result.deleted);
    setListings((rows) => rows.filter((row) => !deleted.has(row.id)));
    setCheckedListingIds((ids) => ids.filter((id) => !deleted.has(id)));
    setSelectedId((current) => {
      if (!deleted.has(current)) return current;
      return listings.find((listing) => !deleted.has(listing.id))?.id || "";
    });
    setSaving(false);
    setToast(`Deleted ${deleted.size} listing${deleted.size === 1 ? "" : "s"}`);
    window.setTimeout(() => setToast(""), 2200);
  }

  async function applyPickupLocation(ids: string[] = []) {
    setSaving(true);
    const result = await api.applyPickupLocation(ids);
    await loadAll();
    setSaving(false);
    setToast(`Applied ${result.location || "pickup location"} to ${result.updated.length} listings`);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function importExisting() {
    setSaving(true);
    const counts = await api.importExisting();
    await loadAll();
    setSaving(false);
    setToast(`Imported ${Object.values(counts).reduce((sum, value) => sum + value, 0)} records`);
    window.setTimeout(() => setToast(""), 2500);
  }

  async function commitPhotoBatch(batchId: string, groups: IntakeGroup[]) {
    setSaving(true);
    const result = await api.commitPhotoBatch(batchId, groups);
    await loadAll();
    setSelectedId(result.created[0] || "");
    setView("review");
    setSaving(false);
    setToast(`Created ${result.created.length} listing${result.created.length === 1 ? "" : "s"}`);
    window.setTimeout(() => setToast(""), 2500);
  }

  async function createBtcEntry(data: Partial<BtcEntry>) {
    setSaving(true);
    await api.createBtcEntry(data);
    const [nextEntries, nextSummary] = await Promise.all([api.getBtcEntries(), api.getBtcSummary()]);
    setBtcEntries(nextEntries);
    setBtcSummary(nextSummary);
    setSaving(false);
    setToast("BTC progress updated");
    window.setTimeout(() => setToast(""), 2200);
  }

  async function deleteBtcEntry(id: number) {
    if (!window.confirm("Delete this BTC progress entry?")) return;
    setSaving(true);
    await api.deleteBtcEntry(id);
    const [nextEntries, nextSummary] = await Promise.all([api.getBtcEntries(), api.getBtcSummary()]);
    setBtcEntries(nextEntries);
    setBtcSummary(nextSummary);
    setSaving(false);
    setToast("BTC progress entry deleted");
    window.setTimeout(() => setToast(""), 2200);
  }

  async function addListingProceeds(listing: Listing) {
    await createBtcEntry({
      entry_type: "sale_proceeds",
      title: listing.title || "Marketplace sale proceeds",
      amount_usd: listing.price || 0,
      btc_amount: 0,
      btc_price_usd: settings?.manual_btc_usd_price || null,
      listing_id: listing.id,
      notes: "Added from listing review.",
      entry_date: new Date().toISOString().slice(0, 10),
    });
    setView("btc");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">FB</div>
          <div>
            <strong>Bulk Facebook Marketplace Poster</strong>
            <span>Path to 1 BTC side tracker</span>
          </div>
        </div>
        <nav aria-label="Main navigation">
          <NavButton icon={<UploadCloud />} label="Intake" active={view === "intake"} onClick={() => setView("intake")} />
          <NavButton icon={<LayoutDashboard />} label="Review" active={view === "review"} onClick={() => setView("review")} />
          <NavButton icon={<Bitcoin />} label="Path to 1 BTC" active={view === "btc"} onClick={() => setView("btc")} />
          <NavButton icon={<Bot />} label="Agent Setup" active={view === "agents"} onClick={() => setView("agents")} />
          <NavButton icon={<ShipWheel />} label="Posting Queue" active={view === "posting"} onClick={() => setView("posting")} />
          <NavButton icon={<ClipboardList />} label="Run Log" active={view === "logs"} onClick={() => setView("logs")} />
          <NavButton icon={<Settings />} label="Settings" active={view === "settings"} onClick={() => setView("settings")} />
        </nav>
        <button className="secondary-action" onClick={importExisting} disabled={saving}>
          <Upload size={16} /> Import current outputs
        </button>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{settings?.project_name || "Bulk Facebook Marketplace Poster"}</h1>
            <p>Bulk listing and live posting · Path to 1 BTC side tracker · {listings.length} listings · {listings.filter((row) => row.approved).length} approved · {saving ? "Saving" : "Saved"}</p>
          </div>
          <div className="topbar-actions">
            {toast && <span className="toast">{toast}</span>}
            <button className="icon-button" aria-label="Refresh data" onClick={loadAll}>
              <RefreshCw size={18} />
            </button>
          </div>
        </header>
        {view === "intake" && settings && (
          <IntakeView
            settings={settings}
            onUploaded={(message) => {
              setToast(message);
              window.setTimeout(() => setToast(""), 2200);
            }}
            onCommit={commitPhotoBatch}
          />
        )}
        {view === "review" && (
          <ReviewView
            listings={filtered}
            selected={selected}
            query={query}
            statusFilter={statusFilter}
            checkedListingIds={checkedListingIds}
            onQuery={setQuery}
            onStatusFilter={(value) => {
              setStatusFilter(value);
              setCheckedListingIds([]);
            }}
            onSelect={setSelectedId}
            onToggleChecked={(id, checked) => setCheckedListingIds((ids) => checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id))}
            onToggleAll={(ids, checked) => setCheckedListingIds(checked ? ids : [])}
            onDeleteListings={deleteListings}
            onPatch={mutateListing}
            onPatchPhoto={mutatePhoto}
            onApprove={approve}
            onRecognize={recognize}
            onAddProceeds={addListingProceeds}
          />
        )}
        {view === "btc" && settings && btcSummary && (
          <BtcGoalView
            settings={settings}
            summary={btcSummary}
            entries={btcEntries}
            listings={listings}
            onCreate={createBtcEntry}
            onDelete={deleteBtcEntry}
            onSaveSettings={async (data) => {
              const next = await api.patchSettings(data);
              setSettings(next);
              setBtcSummary(await api.getBtcSummary());
            }}
          />
        )}
        {view === "agents" && <AgentSetupView settings={settings} selectedIds={handoffIds} listings={listings} />}
        {view === "posting" && <PostingQueue listings={listings.filter((row) => row.approved)} settings={settings} />}
        {view === "logs" && <RunLog logs={logs} />}
        {view === "settings" && settings && (
          <SettingsView
            settings={settings}
            onSave={async (data) => setSettings(await api.patchSettings(data))}
            onApplyPickupLocation={() => applyPickupLocation()}
          />
        )}
      </main>
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function BtcGoalView({
  settings,
  summary,
  entries,
  listings,
  onCreate,
  onDelete,
  onSaveSettings,
}: {
  settings: AppSettings;
  summary: BtcSummary;
  entries: BtcEntry[];
  listings: Listing[];
  onCreate: (data: Partial<BtcEntry>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onSaveSettings: (data: Partial<AppSettings>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<BtcEntry>>({
    entry_type: "sale_proceeds",
    title: "",
    amount_usd: 0,
    btc_amount: 0,
    btc_price_usd: settings.manual_btc_usd_price,
    listing_id: "",
    notes: "",
    entry_date: new Date().toISOString().slice(0, 10),
  });
  const [goalDraft, setGoalDraft] = useState({
    btc_goal_amount: settings.btc_goal_amount,
    btc_owned: settings.btc_owned,
    manual_btc_usd_price: settings.manual_btc_usd_price,
    google_sheet_url: settings.google_sheet_url,
    kraken_referral_url: settings.kraken_referral_url,
  });

  useEffect(() => {
    setGoalDraft({
      btc_goal_amount: settings.btc_goal_amount,
      btc_owned: settings.btc_owned,
      manual_btc_usd_price: settings.manual_btc_usd_price,
      google_sheet_url: settings.google_sheet_url,
      kraken_referral_url: settings.kraken_referral_url,
    });
  }, [settings]);

  async function submitEntry(event: React.FormEvent) {
    event.preventDefault();
    await onCreate({
      ...draft,
      title: draft.title || String(draft.entry_type || "Progress entry").replace(/_/g, " "),
      amount_usd: Number(draft.amount_usd || 0),
      btc_amount: Number(draft.btc_amount || 0),
      btc_price_usd: draft.btc_price_usd ? Number(draft.btc_price_usd) : settings.manual_btc_usd_price,
      listing_id: draft.listing_id || null,
    });
    setDraft({
      entry_type: "sale_proceeds",
      title: "",
      amount_usd: 0,
      btc_amount: 0,
      btc_price_usd: settings.manual_btc_usd_price,
      listing_id: "",
      notes: "",
      entry_date: new Date().toISOString().slice(0, 10),
    });
  }

  return (
    <section className="btc-layout">
      <div className="btc-hero">
        <div>
          <span className="eyebrow">Path to 1 BTC</span>
          <h2>Turn old stuff into Bitcoin progress</h2>
          <p>A side tracker for sale proceeds, BTC buys, and manual progress. Set any goal amount, keep it local, and export the ledger when needed.</p>
        </div>
        <div className="btc-progress-ring" aria-label={`${summary.progress_percent.toFixed(1)} percent toward goal`}>
          <strong>{summary.progress_percent.toFixed(1)}%</strong>
          <span>{formatBtc(summary.projected_btc)}</span>
        </div>
      </div>

      <div className="btc-stat-grid">
        <MetricCard icon={<Target />} label="Goal" value={formatBtc(summary.goal_btc)} detail={`${formatBtc(summary.remaining_btc)} remaining`} />
        <MetricCard icon={<Bitcoin />} label="BTC owned" value={formatBtc(summary.total_btc_owned)} detail={`${formatBtc(summary.ledger_btc)} from ledger`} />
        <MetricCard icon={<TrendingUp />} label="Cash set aside" value={formatUsd(summary.available_usd)} detail={`${formatBtc(summary.estimated_purchasable_btc)} est. purchasable`} />
        <MetricCard icon={<Download />} label="Remaining estimate" value={summary.remaining_usd == null ? "Set BTC price" : formatUsd(summary.remaining_usd)} detail={`${formatUsd(summary.manual_btc_usd_price)} manual BTC price`} />
      </div>

      <div className="progress-track" aria-label="BTC goal progress">
        <span style={{ width: `${Math.min(Math.max(summary.progress_percent, 0), 100)}%` }} />
      </div>

      <div className="btc-columns">
        <form className="page-section btc-entry-form" onSubmit={submitEntry}>
          <div className="section-header">
            <div>
              <h2>Add progress</h2>
              <p>Manual entries only. This does not buy, sell, or move Bitcoin.</p>
            </div>
            <Bitcoin size={24} />
          </div>
          <div className="form-grid">
            <Field label="Type">
              <select value={draft.entry_type} onChange={(event) => setDraft({ ...draft, entry_type: event.target.value })}>
                {btcEntryTypes.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
              </select>
            </Field>
            <Field label="Date">
              <input type="date" value={draft.entry_date || ""} onChange={(event) => setDraft({ ...draft, entry_date: event.target.value })} />
            </Field>
            <Field label="Title" wide>
              <input value={draft.title || ""} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Marketplace sale, BTC buy, referral bonus..." />
            </Field>
            <Field label="Amount USD">
              <input type="number" step="0.01" value={draft.amount_usd ?? 0} onChange={(event) => setDraft({ ...draft, amount_usd: Number(event.target.value) })} />
            </Field>
            <Field label="BTC amount">
              <input type="number" step="0.00000001" value={draft.btc_amount ?? 0} onChange={(event) => setDraft({ ...draft, btc_amount: Number(event.target.value) })} />
            </Field>
            <Field label="BTC price">
              <input type="number" step="1" value={draft.btc_price_usd ?? ""} onChange={(event) => setDraft({ ...draft, btc_price_usd: event.target.value ? Number(event.target.value) : null })} />
            </Field>
            <Field label="Linked listing">
              <select value={draft.listing_id || ""} onChange={(event) => setDraft({ ...draft, listing_id: event.target.value })}>
                <option value="">None</option>
                {listings.map((listing) => <option key={listing.id} value={listing.id}>{listing.title || listing.id}</option>)}
              </select>
            </Field>
            <Field label="Notes" wide>
              <textarea className="notes" value={draft.notes || ""} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
            </Field>
          </div>
          <button className="primary" type="submit"><Plus size={16} /> Add entry</button>
        </form>

        <div className="page-section btc-tools">
          <div className="section-header">
            <div>
              <h2>Goal settings</h2>
              <p>Saved on device. Export when you want this in Google Sheets.</p>
            </div>
            <button className="secondary compact" onClick={() => onSaveSettings(goalDraft)}>Save</button>
          </div>
          <div className="form-grid">
            <Field label="Goal amount (BTC)"><input type="number" step="0.00000001" value={goalDraft.btc_goal_amount} onChange={(event) => setGoalDraft({ ...goalDraft, btc_goal_amount: Number(event.target.value) })} /></Field>
            <Field label="Current BTC"><input type="number" step="0.00000001" value={goalDraft.btc_owned} onChange={(event) => setGoalDraft({ ...goalDraft, btc_owned: Number(event.target.value) })} /></Field>
            <Field label="Manual BTC/USD"><input type="number" step="1" value={goalDraft.manual_btc_usd_price} onChange={(event) => setGoalDraft({ ...goalDraft, manual_btc_usd_price: Number(event.target.value) })} /></Field>
            <Field label="Google Sheet URL" wide><input value={goalDraft.google_sheet_url || ""} onChange={(event) => setGoalDraft({ ...goalDraft, google_sheet_url: event.target.value })} /></Field>
            <Field label="Kraken referral URL" wide><input type="password" autoComplete="off" value={goalDraft.kraken_referral_url || ""} onChange={(event) => setGoalDraft({ ...goalDraft, kraken_referral_url: event.target.value })} /></Field>
          </div>
          <div className="export-row">
            <a className="secondary link-button" href="/api/btc-progress/export.csv"><Download size={16} /> CSV</a>
            <a className="secondary link-button" href="/api/btc-progress/export.xlsx"><Download size={16} /> XLSX</a>
            {goalDraft.google_sheet_url && <a className="secondary link-button" href={goalDraft.google_sheet_url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Sheet</a>}
          </div>
          <div className="kraken-card">
            <h3>New to Bitcoin?</h3>
            <p>Kraken can be used to create an account and buy Bitcoin. Referral eligibility, bonus amounts, deposit requirements, and trading terms vary by offer and location.</p>
            <div className="export-row">
              {(goalDraft.kraken_referral_url || settings.kraken_referral_url) && (
                <a className="kraken-button link-button" href="/api/kraken-referral" target="_blank" rel="noreferrer">
                  <Bitcoin size={16} /> Bitcoin on Kraken
                </a>
              )}
              <a className="secondary link-button" href="https://support.kraken.com/articles/kraken-app-referral-program" target="_blank" rel="noreferrer"><ExternalLink size={16} /> Terms context</a>
            </div>
          </div>
        </div>
      </div>

      <div className="page-section">
        <div className="section-header">
          <div>
            <h2>Progress ledger</h2>
            <p>{entries.length} manual entr{entries.length === 1 ? "y" : "ies"} saved locally.</p>
          </div>
        </div>
        <div className="table btc-ledger">
          {entries.map((entry) => (
            <div className="table-row" key={entry.id}>
              <strong>{entry.title}</strong>
              <span>{entry.entry_type.replace(/_/g, " ")}</span>
              <span>{entry.entry_date}</span>
              <span>{formatUsd(entry.amount_usd)}</span>
              <span>{formatBtc(entry.btc_amount)}</span>
              <button className="danger-action compact" onClick={() => onDelete(entry.id)}><Trash2 size={14} /> Delete</button>
            </div>
          ))}
          {!entries.length && <EmptyState title="No BTC entries yet" action="Add sale proceeds or a BTC purchase to start tracking." />}
        </div>
      </div>
    </section>
  );
}

function MetricCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="metric-card">
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function IntakeView({ settings, onUploaded, onCommit }: { settings: AppSettings; onUploaded: (message: string) => void; onCommit: (batchId: string, groups: IntakeGroup[]) => Promise<void> }) {
  const [batch, setBatch] = useState<IntakeBatch | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragPhoto, setDragPhoto] = useState<{ photoId: string; fromGroupId: string } | null>(null);
  const photosById = useMemo(() => new Map((batch?.photos || []).map((photo) => [photo.id, photo])), [batch]);

  function cloneGroups() {
    return (batch?.groups || []).map((group) => ({ ...group, photo_ids: [...group.photo_ids], removed_photo_ids: [...(group.removed_photo_ids || [])] }));
  }

  async function uploadFiles(fileList: FileList | File[], mode: "new" | "append" = batch ? "append" : "new") {
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name));
    if (!files.length) {
      onUploaded("No image files found");
      return;
    }
    setUploading(true);
    try {
      if (mode === "append" && batch) {
        const appendedBatch = await api.appendPhotoIntake(batch.id, files);
        const existingPhotoIds = new Set(batch.photos.map((photo) => photo.id));
        const newPhotos = appendedBatch.photos.filter((photo) => !existingPhotoIds.has(photo.id));
        const newGroups = appendedBatch.groups.filter((group) => group.photo_ids.some((photoId) => !existingPhotoIds.has(photoId)));
        setBatch({
          ...appendedBatch,
          photos: [...batch.photos, ...newPhotos],
          groups: [...batch.groups, ...newGroups],
        });
        onUploaded(`Added ${newPhotos.length} photos`);
      } else {
        const nextBatch = await api.uploadPhotoIntake(files);
        setBatch(nextBatch);
        onUploaded(`Uploaded ${nextBatch.photos.length} photos`);
      }
    } catch (error) {
      onUploaded(`Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setUploading(false);
    }
  }

  function setGroups(groups: IntakeGroup[]) {
    setBatch((current) => current ? { ...current, groups } : current);
  }

  function updateGroup(groupId: string, patch: Partial<IntakeGroup>) {
    setGroups((batch?.groups || []).map((group) => group.id === groupId ? { ...group, ...patch } : group));
  }

  function movePhoto(photoId: string, fromGroupId: string, toGroupId: string) {
    if (fromGroupId === toGroupId) return;
    const groups = cloneGroups();
    const from = groups.find((group) => group.id === fromGroupId);
    const to = groups.find((group) => group.id === toGroupId);
    if (!from || !to) return;
    from.photo_ids = from.photo_ids.filter((id) => id !== photoId);
    from.removed_photo_ids = from.removed_photo_ids.filter((id) => id !== photoId);
    to.photo_ids.push(photoId);
    to.removed_photo_ids = to.removed_photo_ids.filter((id) => id !== photoId);
    if (!from.cover_photo_id || from.cover_photo_id === photoId) from.cover_photo_id = from.photo_ids[0] || "";
    if (!to.cover_photo_id) to.cover_photo_id = photoId;
    setGroups(groups);
  }

  function movePhotoToNewGroup(photoId: string, fromGroupId: string) {
    const groups = cloneGroups();
    const from = groups.find((group) => group.id === fromGroupId);
    if (!from) return;
    from.photo_ids = from.photo_ids.filter((id) => id !== photoId);
    from.removed_photo_ids = from.removed_photo_ids.filter((id) => id !== photoId);
    if (from.cover_photo_id === photoId) from.cover_photo_id = from.photo_ids[0] || "";
    groups.push({
      id: `group-${Date.now()}`,
      title: `New listing ${groups.length + 1}`,
      photo_ids: [photoId],
      removed_photo_ids: [],
      cover_photo_id: photoId,
    });
    setGroups(groups);
  }

  function splitGroupAt(groupId: string, photoId: string) {
    const groups = cloneGroups();
    const index = groups.findIndex((group) => group.id === groupId);
    const group = groups[index];
    if (!group) return;
    const splitIndex = group.photo_ids.indexOf(photoId);
    if (splitIndex <= 0) return;
    const splitIds = group.photo_ids.slice(splitIndex);
    group.photo_ids = group.photo_ids.slice(0, splitIndex);
    const splitRemoved = new Set(group.removed_photo_ids.filter((id) => splitIds.includes(id)));
    group.removed_photo_ids = group.removed_photo_ids.filter((id) => group.photo_ids.includes(id));
    group.cover_photo_id = group.photo_ids.includes(group.cover_photo_id) ? group.cover_photo_id : group.photo_ids.find((id) => !group.removed_photo_ids.includes(id)) || group.photo_ids[0] || "";
    const nextGroup: IntakeGroup = {
      id: `group-${Date.now()}`,
      title: `New listing ${groups.length + 1}`,
      photo_ids: splitIds,
      removed_photo_ids: [...splitRemoved],
      cover_photo_id: splitIds.includes(group.cover_photo_id) ? group.cover_photo_id : splitIds.find((id) => !splitRemoved.has(id)) || splitIds[0] || "",
    };
    groups.splice(index + 1, 0, nextGroup);
    setGroups(groups);
  }

  function mergeGroup(index: number) {
    const groups = cloneGroups();
    if (index <= 0) return;
    const previous = groups[index - 1];
    const current = groups[index];
    previous.photo_ids = [...previous.photo_ids, ...current.photo_ids];
    previous.removed_photo_ids = [...new Set([...previous.removed_photo_ids, ...current.removed_photo_ids])];
    groups.splice(index, 1);
    setGroups(groups);
  }

  function createEmptyGroup() {
    const groups = cloneGroups();
    groups.push({
      id: `group-${Date.now()}`,
      title: `New listing ${groups.length + 1}`,
      photo_ids: [],
      removed_photo_ids: [],
      cover_photo_id: "",
    });
    setGroups(groups);
  }

  function splitEveryPhoto() {
    const photos = cloneGroups()
      .flatMap((group) => group.photo_ids.filter((photoId) => !(group.removed_photo_ids || []).includes(photoId)))
      .filter((photoId, index, all) => all.indexOf(photoId) === index);
    const groups = photos.map((photoId, index) => ({
      id: `group-${Date.now()}-${index}`,
      title: `New listing ${index + 1}`,
      photo_ids: [photoId],
      removed_photo_ids: [],
      cover_photo_id: photoId,
    }));
    setGroups(groups);
  }

  function toggleRemoved(group: IntakeGroup, photoId: string) {
    const removed = new Set(group.removed_photo_ids || []);
    if (removed.has(photoId)) removed.delete(photoId);
    else removed.add(photoId);
    const nextRemoved = [...removed];
    const activeIds = group.photo_ids.filter((id) => !removed.has(id));
    updateGroup(group.id, {
      removed_photo_ids: nextRemoved,
      cover_photo_id: activeIds.includes(group.cover_photo_id) ? group.cover_photo_id : activeIds[0] || "",
    });
  }

  const activeGroupCount = (batch?.groups || []).filter((group) => group.photo_ids.some((id) => !(group.removed_photo_ids || []).includes(id))).length;

  return (
    <section className="intake-layout">
      <div className="page-section intro-panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">Photo intake</span>
            <h2>Drop photos, then turn groups into draft listings</h2>
            <p>Original photos stay untouched. Uploaded copies are stored in the local project and start as needs-review listings.</p>
          </div>
          <span className="pill green">{settings.default_condition}</span>
        </div>
        <div
          className={`dropzone ${dragging ? "dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            uploadFiles(event.dataTransfer.files);
          }}
        >
          <UploadCloud size={30} />
          <strong>{uploading ? "Uploading photos..." : batch ? "Add more photos to this batch" : "Drag photos here"}</strong>
          <span>{batch ? "New uploads will appear as extra listing groups below." : "or choose JPG, PNG, HEIC, HEIF, or WebP files"}</span>
          <label className={`primary file-trigger ${uploading ? "disabled" : ""}`} aria-disabled={uploading}>
            <Upload size={16} /> {batch ? "Add photos" : "Choose photos"}
            <input
              className="file-input"
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              disabled={uploading}
              onChange={(event) => {
                if (event.target.files) uploadFiles(event.target.files, batch ? "append" : "new");
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {batch ? (
        <div className="page-section">
          <div className="section-header">
            <div>
              <h2>{batch.photos.length} photos in {batch.groups.length} listing groups</h2>
              <p>Drag photos between listing groups, split where the item changes, or add a blank listing for the next item.</p>
            </div>
            <button className="primary" disabled={!activeGroupCount} onClick={() => onCommit(batch.id, batch.groups)}>
              <Check size={16} /> Create {activeGroupCount} listings
            </button>
          </div>
          <div className="intake-toolbar">
            <button className="secondary compact" onClick={createEmptyGroup}><Plus size={14} /> New listing group</button>
            <button className="secondary compact" disabled={!batch.photos.length} onClick={splitEveryPhoto}>One listing per photo</button>
            <button className="secondary compact" onClick={() => setBatch(null)}>Start fresh batch</button>
          </div>
          <div className="intake-groups">
            {batch.groups.map((group, index) => {
              const activePhotos = group.photo_ids.filter((id) => !group.removed_photo_ids.includes(id));
              return (
                <div
                  className={`intake-group ${dragPhoto && dragPhoto.fromGroupId !== group.id ? "drop-target" : ""}`}
                  key={group.id}
                  onDragOver={(event) => {
                    if (dragPhoto) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragPhoto) movePhoto(dragPhoto.photoId, dragPhoto.fromGroupId, group.id);
                    setDragPhoto(null);
                  }}
                >
                  <div className="group-header">
                    <input value={group.title} onChange={(event) => updateGroup(group.id, { title: event.target.value })} aria-label="Group title" />
                    <div className="group-actions">
                      <button className="secondary compact" disabled={index === 0} onClick={() => mergeGroup(index)}>Merge up</button>
                      <button className="secondary compact" onClick={createEmptyGroup}><Plus size={14} /> Add listing</button>
                    </div>
                  </div>
                  <div className="intake-photo-grid">
                    {group.photo_ids.map((photoId) => {
                      const photo = photosById.get(photoId);
                      if (!photo) return null;
                      const removed = group.removed_photo_ids.includes(photoId);
                      return (
                        <div
                          className={`intake-photo ${removed ? "removed" : ""}`}
                          key={photoId}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            setDragPhoto({ photoId, fromGroupId: group.id });
                          }}
                          onDragEnd={() => setDragPhoto(null)}
                        >
                          <button className={`thumb-button ${group.cover_photo_id === photoId ? "cover" : ""}`} onClick={() => updateGroup(group.id, { cover_photo_id: photoId })}>
                            <img src={photo.uri} alt={photo.name} loading="lazy" />
                          </button>
                          <strong>{photo.name}</strong>
                          <div className="thumb-actions">
                            <button onClick={() => toggleRemoved(group, photoId)}>{removed ? "Restore" : "Remove"}</button>
                            <button disabled={group.photo_ids.indexOf(photoId) === 0} onClick={() => splitGroupAt(group.id, photoId)}>Split</button>
                            <button onClick={() => movePhotoToNewGroup(photoId, group.id)}>New listing</button>
                          </div>
                          {batch.groups.length > 1 && (
                            <select value="" onChange={(event) => event.target.value && movePhoto(photoId, group.id, event.target.value)} aria-label="Move photo to group">
                              <option value="">Move to...</option>
                              {batch.groups.filter((target) => target.id !== group.id).map((target) => <option value={target.id} key={target.id}>{target.title}</option>)}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <small>{activePhotos.length} active photo{activePhotos.length === 1 ? "" : "s"}</small>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="page-section">
          <EmptyState title="No upload batch yet" action="Drop a set of item photos to start the import process." />
        </div>
      )}
    </section>
  );
}

function AgentSetupView({ settings, selectedIds, listings }: { settings: AppSettings | null; selectedIds: string[]; listings: Listing[] }) {
  const [copied, setCopied] = useState("");
  const selectedListings = listings.filter((listing) => selectedIds.includes(listing.id));
  const idText = selectedIds.length ? selectedIds.join(", ") : "No listings selected";
  const gates = `comp_research_enabled=${Boolean(settings?.comp_research_enabled)}, image_research_enabled=${Boolean(settings?.image_research_enabled)}, auto_publish=${Boolean(settings?.auto_publish)}`;

  async function copy(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
  }

  function prompt(kind: "research" | "descriptions" | "post") {
    if (kind === "post") {
      return `You are working in ${repoUrl}. Use the local Bulk Facebook Marketplace Poster app at http://127.0.0.1:8766. Post only these approved listing IDs live to Facebook: ${idText}. Facebook drafts are not a reliable handoff surface, so use scripts/facebook_marketplace_worker.js with --ids and --live for the selected listings after Settings has auto_publish=true. The worker opens Facebook, waits for browser login, fills the item form, advances through enabled Next/Skip/Not now steps until Publish, and records posting_status through the app. Take screenshots on failure.`;
    }
    if (kind === "descriptions") {
      return `You are working in ${repoUrl}. Use the local app API at http://127.0.0.1:8766. Improve buyer-facing descriptions for these listing IDs: ${idText}. Do not include internal notes, pipeline language, or research notes in public descriptions. Save uncertainty in private_notes and patch results back through /api/listings/{id}. Current gates: ${gates}.`;
    }
    return `You are working in ${repoUrl}. Use the local app API at http://127.0.0.1:8766. Research selected listings: ${idText}. Respect settings before searching: ${gates}. If comp_research_enabled=false, do not search prices. If image_research_enabled=false, do not find extra photos. Save source links, confidence, recommended price, private notes, and any web image candidates back through the app API. Do not approve listings unless I explicitly ask.`;
  }

  return (
    <section className="agent-layout">
      <div className="page-section intro-panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">Agent setup</span>
            <h2>Best with Codex or Claude Code</h2>
            <p>Open this GitHub repo in your agent app, then use scoped prompts from this workstation for research, cleanup, and posting automation.</p>
          </div>
          <Bot size={28} />
        </div>
        <div className="repo-copy">
          <Github size={18} />
          <code>{repoUrl}</code>
          <button className="secondary compact" onClick={() => copy("repo", repoUrl)}><Copy size={15} /> Copy</button>
        </div>
        <FacebookQuickLinks />
        {copied && <div className="validation ok"><Check size={16} /> Copied {copied}</div>}
      </div>

      <div className="agent-cards">
        <SetupCard
          title="Open in Codex"
          body="Install or open Codex, connect GitHub if available, then open this repo. If the connector is unavailable, clone locally and run the commands below."
          command={`git clone ${repoUrl}.git\ncd marketplace-bulk-workstation\nnpm install && npm --prefix app/frontend install\nnpm run frontend:build\nnpm run app`}
          onCopy={(text) => copy("Codex setup", text)}
        />
        <SetupCard
          title="Open in Claude Code"
          body="Clone the repo, open the folder in Claude Code, and authenticate GitHub locally when you want Claude to push changes."
          command={`git clone ${repoUrl}.git\ncd marketplace-bulk-workstation\ngh auth login\nnpm run app`}
          onCopy={(text) => copy("Claude setup", text)}
        />
        <SetupCard
          title="Verify posting access"
          body="Keep Facebook credentials in the browser only. Draft mode is only a smoke test; live posting requires approved listings plus the Settings gate."
          command={`npm run post:drafts\nnpm run post:live -- --ids ${selectedIds[0] || "example-001"}`}
          onCopy={(text) => copy("posting check", text)}
        />
      </div>

      <div className="page-section">
        <div className="section-header">
          <div>
            <h2>Agent handoff prompts</h2>
            <p>{selectedIds.length ? `${selectedIds.length} selected listing${selectedIds.length === 1 ? "" : "s"}` : "Select listings in Review first, or edit the copied prompt."}</p>
          </div>
          <FileText size={24} />
        </div>
        <div className="handoff-grid">
          <PromptCard title="Research selected" text={prompt("research")} onCopy={(text) => copy("research prompt", text)} />
          <PromptCard title="Improve descriptions" text={prompt("descriptions")} onCopy={(text) => copy("description prompt", text)} />
          <PromptCard title="Post approved" text={prompt("post")} onCopy={(text) => copy("posting prompt", text)} />
        </div>
        <div className="checklist">
          <span><Check size={15} /> Local app reachable at 127.0.0.1:8766</span>
          <span className={settings?.comp_research_enabled ? "ready" : ""}><Search size={15} /> Comp research {settings?.comp_research_enabled ? "enabled" : "off"}</span>
          <span className={settings?.image_research_enabled ? "ready" : ""}><Images size={15} /> Image research {settings?.image_research_enabled ? "enabled" : "off"}</span>
          <span><ShipWheel size={15} /> Worker pauses for Facebook browser login before posting</span>
        </div>
      </div>
      {selectedListings.length > 0 && (
        <div className="page-section">
          <div className="section-header">
            <h2>Selected context</h2>
          </div>
          <div className="table compact-table">
            {selectedListings.map((listing) => (
              <div className="table-row" key={listing.id}>
                <strong>{listing.id}</strong>
                <span>{listing.title || "Untitled"}</span>
                <span>{listing.approved ? "Approved" : "Review"}</span>
                <span>{listing.photos.filter((photo) => !photo.removed).length} photos</span>
                <span>{listing.validation.length} checks</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SetupCard({ title, body, command, onCopy }: { title: string; body: string; command: string; onCopy: (text: string) => void }) {
  return (
    <div className="setup-card">
      <h3>{title}</h3>
      <p>{body}</p>
      <pre>{command}</pre>
      <button className="secondary compact" onClick={() => onCopy(command)}><Copy size={15} /> Copy commands</button>
    </div>
  );
}

function PromptCard({ title, text, onCopy }: { title: string; text: string; onCopy: (text: string) => void }) {
  return (
    <div className="prompt-card">
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      <button className="secondary compact" onClick={() => onCopy(text)}><Copy size={15} /> Copy prompt</button>
    </div>
  );
}

function ReviewView(props: {
  listings: Listing[];
  selected?: Listing;
  query: string;
  statusFilter: string;
  checkedListingIds: string[];
  onQuery: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onSelect: (id: string) => void;
  onToggleChecked: (id: string, checked: boolean) => void;
  onToggleAll: (ids: string[], checked: boolean) => void;
  onDeleteListings: (ids: string[]) => Promise<void>;
  onPatch: (id: string, data: Partial<Listing>) => Promise<void>;
  onPatchPhoto: (listingId: string, photoId: string, data: Partial<Photo>) => Promise<void>;
  onApprove: (id: string, approved: boolean) => Promise<void>;
  onRecognize: (ids: string[]) => Promise<void>;
  onAddProceeds: (listing: Listing) => Promise<void>;
}) {
  const canDelete = props.statusFilter === "all" || props.statusFilter === "needs_review";
  const visibleIds = props.listings.map((listing) => listing.id);
  const checkedVisibleIds = props.checkedListingIds.filter((id) => visibleIds.includes(id));
  const allVisibleChecked = visibleIds.length > 0 && checkedVisibleIds.length === visibleIds.length;
  return (
    <section className="review-grid">
      <div className="listing-pane">
        <div className="search-row">
          <Search size={16} />
          <input value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="Search listings" aria-label="Search listings" />
        </div>
        <div className="segmented" role="tablist" aria-label="Listing status filter">
          {["all", "needs_review", "approved"].map((status) => (
            <button key={status} className={props.statusFilter === status ? "selected" : ""} onClick={() => props.onStatusFilter(status)}>
              {status.replace("_", " ")}
            </button>
          ))}
        </div>
        {canDelete && (
          <div className="bulk-actions" aria-label="Bulk listing actions">
            <label>
              <input
                type="checkbox"
                checked={allVisibleChecked}
                onChange={(event) => props.onToggleAll(visibleIds, event.target.checked)}
              />
              Select visible
            </label>
            <button
              className="danger-action"
              disabled={!checkedVisibleIds.length}
              onClick={() => props.onDeleteListings(checkedVisibleIds)}
            >
              <Trash2 size={15} /> Delete
            </button>
            <button
              className="secondary compact"
              disabled={!checkedVisibleIds.length}
              onClick={() => props.onRecognize(checkedVisibleIds)}
            >
              <ScanSearch size={15} /> Recognize
            </button>
          </div>
        )}
        <div className="listing-list">
          {props.listings.map((listing) => (
            <div key={listing.id} className={`listing-row ${props.selected?.id === listing.id ? "selected" : ""}`}>
              {canDelete && (
                <input
                  className="listing-check"
                  type="checkbox"
                  aria-label={`Select ${listing.title || listing.id}`}
                  checked={props.checkedListingIds.includes(listing.id)}
                  onChange={(event) => props.onToggleChecked(listing.id, event.target.checked)}
                />
              )}
              <button className="listing-select" onClick={() => props.onSelect(listing.id)}>
                <span className={`status-dot ${listing.approved ? "ok" : listing.validation.some((issue) => issue.severity === "error") ? "bad" : "warn"}`} />
                <span>
                  <strong>{listing.title || "Untitled listing"}</strong>
                  <small>{listing.category || "No category"} · {listing.price ? `$${listing.price}` : "No price"}</small>
                </span>
              </button>
            </div>
          ))}
          {!props.listings.length && <EmptyState title="No listings match" action="Clear search or import a project output." />}
        </div>
      </div>
      {props.selected ? (
        <>
          <PhotoWorkbench listing={props.selected} onPatchPhoto={props.onPatchPhoto} />
          <ListingEditor listing={props.selected} onPatch={props.onPatch} onApprove={props.onApprove} onRecognize={() => props.onRecognize([props.selected!.id])} onAddProceeds={props.onAddProceeds} />
        </>
      ) : (
        <div className="empty-wide">
          <EmptyState title="No listings yet" action="Import current outputs, then review and approve items here." />
        </div>
      )}
    </section>
  );
}

function PhotoWorkbench({ listing, onPatchPhoto }: { listing: Listing; onPatchPhoto: (listingId: string, photoId: string, data: Partial<Photo>) => Promise<void> }) {
  const usable = listing.photos.filter((photo) => !photo.removed);
  const cover = usable.find((photo) => photo.cover) || usable[0] || listing.photos[0];
  const [activeId, setActiveId] = useState(cover?.id || "");
  const active = listing.photos.find((photo) => photo.id === activeId) || cover;

  useEffect(() => {
    setActiveId(cover?.id || "");
  }, [listing.id, cover?.id]);

  function next(delta: number) {
    const photos = usable.length ? usable : listing.photos;
    const index = Math.max(0, photos.findIndex((photo) => photo.id === active?.id));
    setActiveId(photos[(index + delta + photos.length) % photos.length]?.id || "");
  }

  async function reorder(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const photos = [...listing.photos].sort((a, b) => a.sort_order - b.sort_order);
    const from = photos.findIndex((photo) => photo.id === draggedId);
    const to = photos.findIndex((photo) => photo.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = photos.splice(from, 1);
    photos.splice(to, 0, moved);
    await Promise.all(photos.map((photo, index) => onPatchPhoto(listing.id, photo.id, { sort_order: index + 1 })));
  }

  return (
    <section className="photo-pane" aria-label="Photo review">
      <div className="photo-stage">
        {active ? <img src={photoSrc(active)} alt={active.provenance || listing.title} /> : <ImageOff size={56} />}
        <button className="stage-nav left" aria-label="Previous photo" onClick={() => next(-1)}><ChevronLeft /></button>
        <button className="stage-nav right" aria-label="Next photo" onClick={() => next(1)}><ChevronRight /></button>
      </div>
      <div className="photo-toolbar">
        <strong>{active?.cover ? "Cover photo" : "Photo preview"}</strong>
        <span>{active?.kind || "No photo"} {active?.removed ? "· removed" : ""}</span>
      </div>
      <div className="thumb-grid">
        {listing.photos.map((photo) => (
          <div
            key={photo.id}
            className={`thumb-cell ${photo.removed ? "removed" : ""}`}
            draggable
            onDragStart={(event) => event.dataTransfer.setData("text/photo-id", photo.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => reorder(event.dataTransfer.getData("text/photo-id"), photo.id)}
          >
            <button className={`thumb-button ${photo.id === active?.id ? "active" : ""} ${photo.cover ? "cover" : ""}`} onClick={() => setActiveId(photo.id)}>
              <img src={photoSrc(photo)} alt={photo.provenance || listing.title} loading="lazy" />
            </button>
            <div className="thumb-actions">
              <button onClick={() => onPatchPhoto(listing.id, photo.id, { cover: true, removed: false })}>Cover</button>
              <button onClick={() => onPatchPhoto(listing.id, photo.id, { removed: !photo.removed })}>{photo.removed ? "Restore" : "Remove"}</button>
            </div>
            {photo.rights_warning && <small>{photo.rights_warning}</small>}
          </div>
        ))}
      </div>
    </section>
  );
}

function ListingEditor({ listing, onPatch, onApprove, onRecognize, onAddProceeds }: { listing: Listing; onPatch: (id: string, data: Partial<Listing>) => Promise<void>; onApprove: (id: string, approved: boolean) => Promise<void>; onRecognize: () => Promise<void>; onAddProceeds: (listing: Listing) => Promise<void> }) {
  const [draft, setDraft] = useState(listing);
  useEffect(() => setDraft(listing), [listing]);

  function setField<K extends keyof Listing>(field: K, value: Listing[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  return (
    <section className="editor-pane" aria-label="Listing editor">
      <div className="editor-header">
        <div>
          <span className="eyebrow">{listing.id} · {listing.source}</span>
          <h2>{listing.title || "Untitled listing"}</h2>
        </div>
        <span className={`pill ${listing.approved ? "green" : "amber"}`}>{listing.approved ? "Approved" : "Needs review"}</span>
      </div>
      <ValidationPanel issues={listing.validation} />
      <div className="form-grid">
        <Field label="Title" wide>
          <input value={draft.title} maxLength={150} onChange={(event) => setField("title", event.target.value)} onBlur={() => onPatch(listing.id, { title: draft.title })} />
        </Field>
        <Field label="Price">
          <input type="number" min="0" value={draft.price ?? ""} onChange={(event) => setField("price", event.target.value ? Number(event.target.value) : null)} onBlur={() => onPatch(listing.id, { price: draft.price })} />
        </Field>
        <Field label="Condition">
          <select value={draft.condition} onChange={(event) => onPatch(listing.id, { condition: event.target.value })}>
            {conditions.map((condition) => <option key={condition}>{condition}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <input value={draft.category} onChange={(event) => setField("category", event.target.value)} onBlur={() => onPatch(listing.id, { category: draft.category })} />
        </Field>
        <Field label="Quantity wording">
          <input value={draft.quantity_text} onChange={(event) => setField("quantity_text", event.target.value)} onBlur={() => onPatch(listing.id, { quantity_text: draft.quantity_text })} />
        </Field>
        <Field label="Location">
          <input value={draft.location} onChange={(event) => setField("location", event.target.value)} onBlur={() => onPatch(listing.id, { location: draft.location })} />
        </Field>
        <Field label="Package weight (oz)">
          <input type="number" min="0" value={draft.package_weight_oz ?? ""} onChange={(event) => setField("package_weight_oz", event.target.value ? Number(event.target.value) : null)} onBlur={() => onPatch(listing.id, { package_weight_oz: draft.package_weight_oz })} />
        </Field>
        <Field label="Delivery">
          <div className="toggle-row">
            <label><input type="checkbox" checked={draft.pickup_enabled} onChange={(event) => onPatch(listing.id, { pickup_enabled: event.target.checked })} /> Pickup</label>
            <label><input type="checkbox" checked={draft.shipping_enabled} onChange={(event) => onPatch(listing.id, { shipping_enabled: event.target.checked })} /> Shipping</label>
          </div>
        </Field>
        <Field label="Description" wide>
          <textarea value={draft.description} onChange={(event) => setField("description", event.target.value)} onBlur={() => onPatch(listing.id, { description: draft.description })} />
        </Field>
        <Field label="Private notes" wide>
          <textarea className="notes" value={draft.private_notes} onChange={(event) => setField("private_notes", event.target.value)} onBlur={() => onPatch(listing.id, { private_notes: draft.private_notes })} />
        </Field>
      </div>
      <div className="approval-actions">
        <button className="primary" onClick={() => onApprove(listing.id, true)}><Check size={16} /> Approve</button>
        <button className="secondary" onClick={onRecognize}><ScanSearch size={16} /> Recognize photos</button>
        <button className="secondary" onClick={() => onApprove(listing.id, false)}>Unapprove</button>
        <button className="secondary" disabled={!listing.price} onClick={() => onAddProceeds(listing)}><Bitcoin size={16} /> Add proceeds to Path to 1 BTC</button>
        <label className="reference-toggle">
          <input type="checkbox" checked={draft.reference_only_approved} onChange={(event) => onPatch(listing.id, { reference_only_approved: event.target.checked })} />
          Allow reference-only photos
        </label>
      </div>
    </section>
  );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function ValidationPanel({ issues }: { issues: Issue[] }) {
  if (!issues.length) {
    return <div className="validation ok"><Check size={16} /> Ready to approve.</div>;
  }
  return (
    <div className="validation">
      {issues.map((issue, index) => (
        <div key={`${issue.field}-${index}`} className={issue.severity}>
          <AlertCircle size={15} />
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

function PostingQueue({ listings, settings }: { listings: Listing[]; settings: AppSettings | null }) {
  return (
    <section className="page-section">
      <div className="section-header">
        <h2>Posting Queue</h2>
        <p>{settings?.auto_publish ? "Live posting is enabled for approved listings." : "Live posting is off. Enable it in Settings before running the worker with --live."}</p>
      </div>
      <FacebookQuickLinks />
      <div className="table">
        {listings.map((listing) => (
          <div className="table-row" key={listing.id}>
            <strong>{listing.title}</strong>
            <span>${listing.price ?? 0}</span>
            <span>{listing.condition}</span>
            <span>{listing.photos.filter((photo) => !photo.removed).length} photos</span>
            <span>{listing.shipping_enabled ? "Shipping on" : "Pickup only"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function FacebookQuickLinks() {
  return (
    <div className="facebook-links" aria-label="Facebook Marketplace shortcuts">
      <a className="secondary link-button" href={facebookMarketplaceLinks.createListing} target="_blank" rel="noreferrer">
        <ExternalLink size={16} /> Create listing
      </a>
      <a className="secondary link-button" href={facebookMarketplaceLinks.listings} target="_blank" rel="noreferrer">
        <ExternalLink size={16} /> Marketplace listings
      </a>
      <a className="secondary link-button" href={facebookMarketplaceLinks.drafts} target="_blank" rel="noreferrer">
        <ExternalLink size={16} /> Marketplace drafts
      </a>
    </div>
  );
}

function RunLog({ logs }: { logs: LogRow[] }) {
  return (
    <section className="page-section">
      <div className="section-header">
        <h2>Run Log</h2>
        <p>Posting worker results, failures, screenshots, and resume context appear here.</p>
      </div>
      <div className="table">
        {logs.map((log) => (
          <div className="table-row" key={log.id}>
            <strong>{log.level}</strong>
            <span>{log.listing_id || "Project"}</span>
            <span>{log.message}</span>
            <span>{log.created_at}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsView({ settings, onSave, onApplyPickupLocation }: { settings: AppSettings; onSave: (data: Partial<AppSettings>) => Promise<void>; onApplyPickupLocation: () => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const refreshCommand = "npm run refresh:listings:auto";
  const copyRefreshCommand = async () => {
    await navigator.clipboard?.writeText(refreshCommand);
  };
  return (
    <section className="settings-grid">
      <div className="page-section">
        <div className="section-header">
          <h2>Project Settings</h2>
          <p>These defaults shape listing copy, validation, and browser automation behavior.</p>
        </div>
        <div className="form-grid settings-form">
          <Field label="Project name" wide><input value={draft.project_name} onChange={(event) => setDraft({ ...draft, project_name: event.target.value })} /></Field>
          <Field label="Facebook map location"><input value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} /></Field>
          <Field label="Pickup ZIP"><input inputMode="numeric" value={draft.pickup_zip_code || ""} onChange={(event) => setDraft({ ...draft, pickup_zip_code: event.target.value })} /></Field>
          <Field label="Pickup place or complex" wide><input value={draft.pickup_place_name || ""} onChange={(event) => setDraft({ ...draft, pickup_place_name: event.target.value })} /></Field>
          <Field label="Default condition"><select value={draft.default_condition} onChange={(event) => setDraft({ ...draft, default_condition: event.target.value })}>{conditions.map((condition) => <option key={condition}>{condition}</option>)}</select></Field>
          <Field label="Batch size"><input type="number" min="1" max="50" value={draft.batch_size} onChange={(event) => setDraft({ ...draft, batch_size: Number(event.target.value) })} /></Field>
          <Field label="Default package weight"><input type="number" min="0" value={draft.default_package_weight_oz ?? ""} onChange={(event) => setDraft({ ...draft, default_package_weight_oz: event.target.value ? Number(event.target.value) : null })} /></Field>
          <Field label="Facebook browser profile" wide><input value={draft.facebook_profile_path} onChange={(event) => setDraft({ ...draft, facebook_profile_path: event.target.value })} /></Field>
          <Field label="Local vision host"><input value={draft.local_vision_ollama_host || ""} onChange={(event) => setDraft({ ...draft, local_vision_ollama_host: event.target.value })} /></Field>
          <Field label="Local vision model"><input value={draft.local_vision_model || ""} onChange={(event) => setDraft({ ...draft, local_vision_model: event.target.value })} /></Field>
          <Field label="Local model store" wide><input value={draft.local_vision_model_root || ""} onChange={(event) => setDraft({ ...draft, local_vision_model_root: event.target.value })} /></Field>
          <Field label="Goal amount (BTC)"><input type="number" step="0.00000001" value={draft.btc_goal_amount} onChange={(event) => setDraft({ ...draft, btc_goal_amount: Number(event.target.value) })} /></Field>
          <Field label="Current BTC owned"><input type="number" step="0.00000001" value={draft.btc_owned} onChange={(event) => setDraft({ ...draft, btc_owned: Number(event.target.value) })} /></Field>
          <Field label="Manual BTC/USD price"><input type="number" min="0" value={draft.manual_btc_usd_price} onChange={(event) => setDraft({ ...draft, manual_btc_usd_price: Number(event.target.value) })} /></Field>
          <Field label="Progress currency"><input value={draft.progress_currency} onChange={(event) => setDraft({ ...draft, progress_currency: event.target.value })} /></Field>
          <Field label="Kraken referral URL" wide><input type="password" autoComplete="off" value={draft.kraken_referral_url} onChange={(event) => setDraft({ ...draft, kraken_referral_url: event.target.value })} /></Field>
          <Field label="Google Sheet URL" wide><input value={draft.google_sheet_url} onChange={(event) => setDraft({ ...draft, google_sheet_url: event.target.value })} /></Field>
          <Field label="Marketplace refresh" wide>
            <div className="refresh-settings">
              <label><input type="checkbox" checked={draft.listing_auto_refresh_enabled} onChange={(event) => setDraft({ ...draft, listing_auto_refresh_enabled: event.target.checked })} /> Automatically refresh older listings</label>
              <div className="settings-inline">
                <span>
                  <small>Every</small>
                  <input type="number" min="3" max="4" value={draft.listing_auto_refresh_interval_days || 3} onChange={(event) => setDraft({ ...draft, listing_auto_refresh_interval_days: Number(event.target.value) })} />
                  <small>days</small>
                </span>
                <span>
                  <small>Limit</small>
                  <input type="number" min="1" max="100" value={draft.listing_auto_refresh_limit || 50} onChange={(event) => setDraft({ ...draft, listing_auto_refresh_limit: Number(event.target.value) })} />
                </span>
              </div>
              <div className="repo-copy refresh-command">
                <span>Command</span>
                <code>{refreshCommand}</code>
                <button type="button" className="secondary compact" onClick={copyRefreshCommand}><Copy size={15} /> Copy</button>
              </div>
              <small>{draft.listing_auto_refresh_last_run_at ? `Last run: ${new Date(draft.listing_auto_refresh_last_run_at).toLocaleString()}` : "Last run: never"}</small>
              {draft.listing_auto_refresh_last_result ? <small>{draft.listing_auto_refresh_last_result}</small> : null}
            </div>
          </Field>
          <Field label="Forbidden public phrases" wide>
            <textarea className="notes" value={draft.forbidden_public_phrases.join("\n")} onChange={(event) => setDraft({ ...draft, forbidden_public_phrases: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })} />
          </Field>
          <div className="settings-toggles">
            <label><input type="checkbox" checked={draft.shipping_enabled_default} onChange={(event) => setDraft({ ...draft, shipping_enabled_default: event.target.checked })} /> Shipping by default</label>
            <label><input type="checkbox" checked={draft.image_research_enabled} onChange={(event) => setDraft({ ...draft, image_research_enabled: event.target.checked })} /> Image research enabled</label>
            <label><input type="checkbox" checked={draft.comp_research_enabled} onChange={(event) => setDraft({ ...draft, comp_research_enabled: event.target.checked })} /> Comp research enabled</label>
            <label><input type="checkbox" checked={draft.local_image_recognition_enabled} onChange={(event) => setDraft({ ...draft, local_image_recognition_enabled: event.target.checked })} /> On-device recognition</label>
            <label><input type="checkbox" checked={draft.local_ocr_enabled} onChange={(event) => setDraft({ ...draft, local_ocr_enabled: event.target.checked })} /> OCR labels and barcodes</label>
            <label><input type="checkbox" checked={draft.auto_publish} onChange={(event) => setDraft({ ...draft, auto_publish: event.target.checked })} /> Live-post approved listings</label>
          </div>
        </div>
        <div className="approval-actions">
          <button className="primary" onClick={() => onSave(draft)}>Save settings</button>
          <button className="secondary" onClick={async () => { await onSave(draft); await onApplyPickupLocation(); }}>Apply pickup to listings</button>
        </div>
      </div>
    </section>
  );
}

function EmptyState({ title, action }: { title: string; action: string }) {
  return (
    <div className="empty-state">
      <ClipboardList size={28} />
      <strong>{title}</strong>
      <span>{action}</span>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
