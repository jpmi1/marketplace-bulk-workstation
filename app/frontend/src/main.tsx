import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ImageOff,
  LayoutDashboard,
  RefreshCw,
  Search,
  Settings,
  ShipWheel,
  Trash2,
  Upload,
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
  default_condition: string;
  default_payment_terms: string;
  default_pickup_terms: string;
  shipping_enabled_default: boolean;
  default_package_weight_oz: number | null;
  carrier_preference: string;
  auto_publish: boolean;
  draft_and_confirm: boolean;
  batch_size: number;
  facebook_profile_path: string;
  image_research_enabled: boolean;
  comp_research_enabled: boolean;
  reference_image_policy: string;
  description_tone: string;
  forbidden_public_phrases: string[];
};
type LogRow = { id: number; listing_id: string | null; level: string; message: string; created_at: string };

const conditions = ["New", "Used - Like New", "Used - Good", "Used - Fair"];
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
  async importExisting(): Promise<Record<string, number>> {
    return fetch("/api/intake/existing-outputs", { method: "POST" }).then((res) => res.json());
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
};

function App() {
  const [view, setView] = useState<"review" | "posting" | "settings" | "logs">("review");
  const [listings, setListings] = useState<Listing[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [checkedListingIds, setCheckedListingIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  async function loadAll() {
    const [nextListings, nextSettings, nextLogs] = await Promise.all([api.getListings(), api.getSettings(), api.getLogs()]);
    setListings(nextListings);
    setSettings(nextSettings);
    setLogs(nextLogs);
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

  async function importExisting() {
    setSaving(true);
    const counts = await api.importExisting();
    await loadAll();
    setSaving(false);
    setToast(`Imported ${Object.values(counts).reduce((sum, value) => sum + value, 0)} records`);
    window.setTimeout(() => setToast(""), 2500);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>Marketplace</strong>
            <span>Bulk workstation</span>
          </div>
        </div>
        <nav aria-label="Main navigation">
          <NavButton icon={<LayoutDashboard />} label="Review" active={view === "review"} onClick={() => setView("review")} />
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
            <h1>{settings?.project_name || "Marketplace Bulk Workstation"}</h1>
            <p>{listings.length} listings · {listings.filter((row) => row.approved).length} approved · {saving ? "Saving" : "Saved"}</p>
          </div>
          <div className="topbar-actions">
            {toast && <span className="toast">{toast}</span>}
            <button className="icon-button" aria-label="Refresh data" onClick={loadAll}>
              <RefreshCw size={18} />
            </button>
          </div>
        </header>
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
          />
        )}
        {view === "posting" && <PostingQueue listings={listings.filter((row) => row.approved)} settings={settings} />}
        {view === "logs" && <RunLog logs={logs} />}
        {view === "settings" && settings && <SettingsView settings={settings} onSave={async (data) => setSettings(await api.patchSettings(data))} />}
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
          <ListingEditor listing={props.selected} onPatch={props.onPatch} onApprove={props.onApprove} />
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

function ListingEditor({ listing, onPatch, onApprove }: { listing: Listing; onPatch: (id: string, data: Partial<Listing>) => Promise<void>; onApprove: (id: string, approved: boolean) => Promise<void> }) {
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
        <button className="secondary" onClick={() => onApprove(listing.id, false)}>Unapprove</button>
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
        <p>{settings?.auto_publish ? "Auto-publish is enabled for approved listings." : "Draft-and-confirm is active. The worker stops before final Publish."}</p>
      </div>
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

function SettingsView({ settings, onSave }: { settings: AppSettings; onSave: (data: Partial<AppSettings>) => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  return (
    <section className="settings-grid">
      <div className="page-section">
        <div className="section-header">
          <h2>Project Settings</h2>
          <p>These defaults shape listing copy, validation, and browser automation behavior.</p>
        </div>
        <div className="form-grid settings-form">
          <Field label="Project name" wide><input value={draft.project_name} onChange={(event) => setDraft({ ...draft, project_name: event.target.value })} /></Field>
          <Field label="Location"><input value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} /></Field>
          <Field label="Default condition"><select value={draft.default_condition} onChange={(event) => setDraft({ ...draft, default_condition: event.target.value })}>{conditions.map((condition) => <option key={condition}>{condition}</option>)}</select></Field>
          <Field label="Batch size"><input type="number" min="1" max="50" value={draft.batch_size} onChange={(event) => setDraft({ ...draft, batch_size: Number(event.target.value) })} /></Field>
          <Field label="Default package weight"><input type="number" min="0" value={draft.default_package_weight_oz ?? ""} onChange={(event) => setDraft({ ...draft, default_package_weight_oz: event.target.value ? Number(event.target.value) : null })} /></Field>
          <Field label="Facebook browser profile" wide><input value={draft.facebook_profile_path} onChange={(event) => setDraft({ ...draft, facebook_profile_path: event.target.value })} /></Field>
          <Field label="Forbidden public phrases" wide>
            <textarea className="notes" value={draft.forbidden_public_phrases.join("\n")} onChange={(event) => setDraft({ ...draft, forbidden_public_phrases: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })} />
          </Field>
          <div className="settings-toggles">
            <label><input type="checkbox" checked={draft.shipping_enabled_default} onChange={(event) => setDraft({ ...draft, shipping_enabled_default: event.target.checked })} /> Shipping by default</label>
            <label><input type="checkbox" checked={draft.image_research_enabled} onChange={(event) => setDraft({ ...draft, image_research_enabled: event.target.checked })} /> Image research enabled</label>
            <label><input type="checkbox" checked={draft.comp_research_enabled} onChange={(event) => setDraft({ ...draft, comp_research_enabled: event.target.checked })} /> Comp research enabled</label>
            <label><input type="checkbox" checked={draft.auto_publish} onChange={(event) => setDraft({ ...draft, auto_publish: event.target.checked })} /> Auto-publish approved listings</label>
          </div>
        </div>
        <button className="primary" onClick={() => onSave(draft)}>Save settings</button>
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
