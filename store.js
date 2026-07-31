/* ============================================================
   CAPA DE DATOS — funciona con Supabase o en modo local
   Expone:
     window.Store  -> registros de vehículos
     window.Users  -> usuarios de portería (creados por el admin)
   Ambos con la misma interfaz:
     .mode, .init(onChange), .list(), .insert(x), .update(id,patch), .remove(id)
   ============================================================ */
(function () {
  const C = window.CONFIG || {};
  const useSupabase = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY);
  const BC = "controlpuerta";

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  let _client = null;
  async function client() {
    if (_client) return _client;
    const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    _client = mod.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
    return _client;
  }

  // sort: función opcional para ordenar la lista
  function makeStore(table, key, sortFn) {
    return {
      mode: useSupabase ? "supabase" : "local",
      table, key,
      _cbs: [], _bc: null,
      async init(onChange) {
        if (onChange) this._cbs.push(onChange);
        if (useSupabase) {
          const sb = await client();
          sb.channel(table + "-rt")
            .on("postgres_changes", { event: "*", schema: "public", table }, () => this._emit())
            .subscribe();
        } else {
          try { this._bc = new BroadcastChannel(BC); this._bc.onmessage = e => { if (e.data === key) this._emit(); }; } catch (e) {}
          window.addEventListener("storage", e => { if (e.key === key) this._emit(); });
        }
        return true;
      },
      _emit() { this._cbs.forEach(f => { try { f(); } catch (e) {} }); },

      // ----- local helpers -----
      _read() { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { return []; } },
      _write(arr) { localStorage.setItem(key, JSON.stringify(arr)); if (this._bc) this._bc.postMessage(key); this._emit(); },

      async list() {
        if (useSupabase) {
          const sb = await client();
          const { data, error } = await sb.from(table).select("*");
          if (error) { console.error(error); return []; }
          return sortFn ? (data || []).slice().sort(sortFn) : (data || []);
        }
        const arr = this._read();
        return sortFn ? arr.slice().sort(sortFn) : arr;
      },
      async insert(rec) {
        rec.id = rec.id || uuid();
        if (useSupabase) {
          const sb = await client();
          const { data, error } = await sb.from(table).insert(rec).select().single();
          if (error) { console.error(error); throw error; }
          return data;
        }
        const arr = this._read(); arr.push(rec); this._write(arr); return rec;
      },
      async update(id, patch) {
        if (useSupabase) {
          const sb = await client();
          const { error } = await sb.from(table).update(patch).eq("id", id);
          if (error) console.error(error);
          return;
        }
        const arr = this._read(); const i = arr.findIndex(r => r.id === id);
        if (i >= 0) { arr[i] = Object.assign({}, arr[i], patch); this._write(arr); }
      },
      async remove(id) {
        if (useSupabase) {
          const sb = await client();
          const { error } = await sb.from(table).delete().eq("id", id);
          if (error) console.error(error);
          return;
        }
        this._write(this._read().filter(r => r.id !== id));
      }
    };
  }

  const byPuertaDesc = (a, b) => new Date(b.t_puerta) - new Date(a.t_puerta);
  const byCreatedAsc = (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0);

  window.Store = makeStore("registros", "controlpuerta_registros", byPuertaDesc);
  window.Users = makeStore("usuarios", "controlpuerta_usuarios", byCreatedAsc);
  window.Store.uuid = uuid;
})();
