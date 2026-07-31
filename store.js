/* ============================================================
   CAPA DE DATOS — funciona con Supabase o en modo local
   Expone window.Store con la misma interfaz en ambos casos:
     Store.mode            -> "supabase" | "local"
     Store.init(onChange)  -> conecta y avisa cambios en vivo
     Store.list()          -> Promise<[registros]>
     Store.insert(rec)     -> Promise<registro>
     Store.update(id,patch)-> Promise<void>
     Store.remove(id)      -> Promise<void>
   ============================================================ */
(function () {
  const C = window.CONFIG || {};
  const useSupabase = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY);

  /* ---------- utilidades comunes ---------- */
  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /* ============================================================
     IMPLEMENTACIÓN LOCAL (localStorage + BroadcastChannel)
     ============================================================ */
  const LocalStore = {
    mode: "local",
    KEY: "controlpuerta_registros",
    _bc: null,
    _onChange: null,
    async init(onChange) {
      this._onChange = onChange;
      try { this._bc = new BroadcastChannel("controlpuerta"); } catch (e) { this._bc = null; }
      if (this._bc) this._bc.onmessage = () => onChange && onChange();
      // sincroniza entre pestañas por el evento storage
      window.addEventListener("storage", e => {
        if (e.key === this.KEY) onChange && onChange();
      });
      return true;
    },
    _read() {
      try { return JSON.parse(localStorage.getItem(this.KEY) || "[]"); }
      catch (e) { return []; }
    },
    _write(arr) {
      localStorage.setItem(this.KEY, JSON.stringify(arr));
      if (this._bc) this._bc.postMessage("change");
      if (this._onChange) this._onChange();
    },
    async list() {
      return this._read().sort((a, b) => new Date(b.t_puerta) - new Date(a.t_puerta));
    },
    async insert(rec) {
      const arr = this._read();
      rec.id = rec.id || uuid();
      arr.push(rec);
      this._write(arr);
      return rec;
    },
    async update(id, patch) {
      const arr = this._read();
      const i = arr.findIndex(r => r.id === id);
      if (i >= 0) { arr[i] = Object.assign({}, arr[i], patch); this._write(arr); }
    },
    async remove(id) {
      this._write(this._read().filter(r => r.id !== id));
    }
  };

  /* ============================================================
     IMPLEMENTACIÓN SUPABASE (tiempo real)
     ============================================================ */
  const SupabaseStore = {
    mode: "supabase",
    sb: null,
    TABLE: "registros",
    async init(onChange) {
      const mod = await import("https://esm.sh/@supabase/supabase-js@2");
      this.sb = mod.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
      this.sb
        .channel("registros-rt")
        .on("postgres_changes",
          { event: "*", schema: "public", table: this.TABLE },
          () => onChange && onChange())
        .subscribe();
      return true;
    },
    async list() {
      const { data, error } = await this.sb.from(this.TABLE)
        .select("*").order("t_puerta", { ascending: false });
      if (error) { console.error(error); return []; }
      return data || [];
    },
    async insert(rec) {
      const { data, error } = await this.sb.from(this.TABLE)
        .insert(rec).select().single();
      if (error) { console.error(error); throw error; }
      return data;
    },
    async update(id, patch) {
      const { error } = await this.sb.from(this.TABLE).update(patch).eq("id", id);
      if (error) console.error(error);
    },
    async remove(id) {
      const { error } = await this.sb.from(this.TABLE).delete().eq("id", id);
      if (error) console.error(error);
    }
  };

  window.Store = useSupabase ? SupabaseStore : LocalStore;
  window.Store.uuid = uuid;
})();
