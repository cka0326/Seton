// Google Drive sync (issue #16).
//
// Rather than talking to the Drive API (OAuth apps, tokens, quotas), every
// project is mirrored into a folder that the Google Drive desktop client
// syncs. Drive then acts as the remote repo: it uploads, versions, and
// distributes the files to other machines.
//
// Layout per project:
//   <syncDir>/<Project Name>/project.seton.json   full importable bundle
//   <syncDir>/<Project Name>/canvases/<name>.md   readable canvas mirror
//   <syncDir>/<Project Name>/documents/<name>.md  readable document mirror
//
// The sync dir is SETON_SYNC_DIR if set, else "<Google Drive>/My Drive/Seton"
// (auto-detected). Syncs are debounced per project and rewrite that project's
// folder completely, pruning files for deleted canvases/documents.
//
// On first run with an empty database, projects found in the sync folder are
// restored — so a fresh machine pointed at the same Drive account picks up
// all notes automatically.

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { canvasToMarkdown, docToMarkdown } from './markdown.js';

const DEBOUNCE_MS = 2000;

const safeName = (s) =>
  (s || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'untitled';

function detectSyncDir() {
  if (process.env.SETON_SYNC_DIR) return process.env.SETON_SYNC_DIR;
  const home = os.homedir();
  const cloud = path.join(home, 'Library', 'CloudStorage'); // macOS
  if (fs.existsSync(cloud)) {
    for (const entry of fs.readdirSync(cloud)) {
      if (!entry.startsWith('GoogleDrive-')) continue;
      const myDrive = path.join(cloud, entry, 'My Drive');
      if (fs.existsSync(myDrive)) return path.join(myDrive, 'Seton');
    }
  }
  for (const cand of [
    path.join(home, 'Google Drive', 'My Drive'), // older client layouts
    path.join(home, 'Google Drive'),
  ]) {
    if (fs.existsSync(cand)) return path.join(cand, 'Seton');
  }
  return null;
}

// write via tmp+rename so the Drive client never uploads a half-written file
function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

// remove .md files we no longer generate (deleted/renamed canvases & docs)
function pruneMd(dir, keep) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.md') && !keep.has(f)) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
  }
}

export function createSync(store) {
  const dir = detectSyncDir();
  const enabled = !!dir;
  const timers = new Map(); // pid → debounce timeout

  if (!enabled) {
    console.log(
      'Drive sync disabled: no Google Drive folder found (set SETON_SYNC_DIR to enable)'
    );
  }

  // Stable folder per project, tracked in meta so renames move the folder
  // instead of orphaning it.
  function folderName(project) {
    const key = `sync-folder:${project.id}`;
    const current = store.getMeta(key);
    let desired = safeName(project.name);
    if (current === desired) return desired;
    if (fs.existsSync(path.join(dir, desired))) {
      desired = `${desired} [${project.id}]`; // name taken by another project
    }
    if (current && fs.existsSync(path.join(dir, current))) {
      try {
        fs.renameSync(path.join(dir, current), path.join(dir, desired));
      } catch {
        /* fall through — files are rewritten below anyway */
      }
    }
    store.setMeta(key, desired);
    return desired;
  }

  function writeProject(pid) {
    const project = store.getProject(pid);
    if (!project) return;
    const canvases = store.listCanvases(pid);
    const documents = store.listDocs(pid);
    const folder = path.join(dir, folderName(project));
    fs.mkdirSync(path.join(folder, 'canvases'), { recursive: true });
    fs.mkdirSync(path.join(folder, 'documents'), { recursive: true });

    writeAtomic(
      path.join(folder, 'project.seton.json'),
      JSON.stringify({ format: 'seton/v1', project, canvases, documents }, null, 2)
    );

    const mdNames = (items, label) => {
      const used = new Set();
      return items.map((it) => {
        let n = safeName(it[label]);
        if (used.has(n.toLowerCase())) n = `${n} [${it.id}]`;
        used.add(n.toLowerCase());
        return `${n}.md`;
      });
    };

    const canvasFiles = mdNames(canvases, 'name');
    canvases.forEach((c, i) =>
      writeAtomic(path.join(folder, 'canvases', canvasFiles[i]), canvasToMarkdown(c))
    );
    pruneMd(path.join(folder, 'canvases'), new Set(canvasFiles));

    const docFiles = mdNames(documents, 'title');
    documents.forEach((d, i) =>
      writeAtomic(path.join(folder, 'documents', docFiles[i]), docToMarkdown(d))
    );
    pruneMd(path.join(folder, 'documents'), new Set(docFiles));
  }

  return {
    enabled,
    dir,

    // Debounced mirror of one project; call after any write to it.
    schedule(pid) {
      if (!enabled) return;
      clearTimeout(timers.get(pid));
      timers.set(
        pid,
        setTimeout(() => {
          timers.delete(pid);
          try {
            writeProject(pid);
            store.setMeta('drive-last-sync', Date.now());
          } catch (err) {
            console.error(`drive sync failed for project ${pid}: ${err.message}`);
          }
        }, DEBOUNCE_MS)
      );
    },

    // Call when a project is deleted in the app.
    removeProject(pid) {
      if (!enabled) return;
      clearTimeout(timers.get(pid));
      timers.delete(pid);
      const folder = store.getMeta(`sync-folder:${pid}`);
      store.deleteMeta(`sync-folder:${pid}`);
      if (!folder) return;
      try {
        fs.rmSync(path.join(dir, folder), { recursive: true, force: true });
      } catch (err) {
        console.error(`drive sync: could not remove ${folder}: ${err.message}`);
      }
    },

    // Mirror every project (startup convergence).
    syncAll() {
      if (!enabled) return;
      for (const p of store.listProjects()) this.schedule(p.id);
    },

    // Fresh machine, same Drive account: pull projects back out of the sync
    // folder. Runs once (meta-flagged) and only when the database is empty.
    restoreIfEmpty() {
      if (!enabled || store.getMeta('drive-restore-checked')) return;
      store.setMeta('drive-restore-checked', new Date().toISOString());
      if (store.listProjects().length > 0 || !fs.existsSync(dir)) return;
      let restored = 0;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const bundleFile = path.join(dir, entry.name, 'project.seton.json');
        if (!fs.existsSync(bundleFile)) continue;
        try {
          const b = JSON.parse(fs.readFileSync(bundleFile, 'utf8'));
          if (b.format !== 'seton/v1' || !b.project?.id) continue;
          if (store.getProject(b.project.id)) continue;
          const now = Date.now();
          store.transaction(() => {
            store.createProject({
              id: b.project.id,
              name: b.project.name || 'Untitled project',
              defaultCanvasId: b.project.defaultCanvasId ?? null,
              createdAt: b.project.createdAt || now,
              updatedAt: b.project.updatedAt || now,
            });
            for (const c of b.canvases || []) store.saveCanvas(b.project.id, c, { touch: false });
            for (const d of b.documents || []) store.saveDoc(b.project.id, d, { touch: false });
          });
          store.setMeta(`sync-folder:${b.project.id}`, entry.name);
          restored++;
        } catch (err) {
          console.error(`drive restore: skipping ${entry.name}: ${err.message}`);
        }
      }
      if (restored) console.log(`Restored ${restored} project(s) from the Drive sync folder`);
    },

    status() {
      const last = Number(store.getMeta('drive-last-sync')) || null;
      return {
        enabled,
        dir: dir ? dir.replace(os.homedir(), '~') : null,
        lastSyncAt: last,
      };
    },
  };
}
