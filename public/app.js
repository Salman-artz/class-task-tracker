(() => {
  'use strict';

  // ---------- state & util ----------
  const $ = (id) => document.getElementById(id);
  const state = { user: null, classes: [], page: 1, editingId: null, busy: false };
  const TOKEN_KEY = 'ctt_token'; // sessionStorage: hilang saat tab ditutup

  const getToken = () => sessionStorage.getItem(TOKEN_KEY);
  const setToken = (t) => (t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY));

  let bannerTimer;
  function banner(message, type = 'error') {
    const el = $('banner');
    el.textContent = message; // textContent, bukan innerHTML -> aman dari XSS
    el.className = `banner ${type}`;
    el.hidden = false;
    clearTimeout(bannerTimer);
    if (type === 'success') bannerTimer = setTimeout(() => (el.hidden = true), 3500);
  }
  const clearBanner = () => ($('banner').hidden = true);

  async function api(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
    let res;
    try {
      res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new Error('Tidak dapat terhubung ke server. Periksa koneksi Anda.');
    }
    if (res.status === 204) return {};
    let json = {};
    try { json = await res.json(); } catch { /* respons bukan JSON */ }
    if (!res.ok) {
      const err = (json && json.error) || {};
      if (res.status === 401 && getToken()) { logout(false); throw new Error('Sesi berakhir, silakan masuk lagi.'); }
      let msg = err.message || `Terjadi kesalahan (${res.status})`;
      if (Array.isArray(err.details) && err.details.length) msg += ': ' + err.details.map((d) => d.message).join('; ');
      throw new Error(msg);
    }
    return json;
  }

  async function withBusy(button, fn) {
    if (state.busy) return;
    state.busy = true;
    if (button) button.disabled = true; // cegah klik ganda (data tersimpan dua kali)
    try { await fn(); } catch (e) { banner(e.message); } finally { state.busy = false; if (button) button.disabled = false; }
  }

  const fmtDate = (iso) => new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  function toLocalInput(iso) {
    const d = new Date(iso);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => (k === 'class' ? (node.className = v) : (node[k] = v)));
    children.forEach((c) => node.append(c));
    return node;
  }

  // ---------- views ----------
  function showView(name) {
    $('view-auth').hidden = name !== 'auth';
    $('view-app').hidden = name !== 'app';
    $('userbox').hidden = name !== 'app';
  }

  function fillClassSelect(select) {
    select.replaceChildren(...state.classes.map((c) => el('option', { value: c.id, textContent: c.name })));
  }

  async function loadClasses() {
    const { data } = await api('GET', '/classes');
    state.classes = data;
    fillClassSelect($('reg-class'));
    fillClassSelect($('task-class'));
  }

  function enterApp(user) {
    state.user = user;
    $('whoami').textContent = `${user.name} (${user.role === 'teacher' ? 'Guru' : 'Siswa'})`;
    $('btn-new').hidden = user.role !== 'teacher';
    $('f-status').hidden = user.role !== 'student';
    $('f-status').value = '';
    $('f-search').value = '';
    state.page = 1;
    hideTaskForm();
    showView('app');
    loadTasks();
  }

  function logout(notify = true) {
    setToken(null);
    state.user = null;
    $('task-list').replaceChildren();
    showView('auth');
    if (notify) banner('Anda sudah keluar.', 'success');
  }

  // ---------- tasks ----------
  async function loadTasks() {
    $('loading').hidden = false;
    $('empty').hidden = true;
    $('task-list').replaceChildren();
    try {
      const q = new URLSearchParams({ page: state.page, limit: 5 });
      const search = $('f-search').value.trim();
      const status = $('f-status').value;
      if (search) q.set('search', search);
      if (status && state.user.role === 'student') q.set('status', status);
      const { data, meta } = await api('GET', `/tasks?${q}`);
      renderTasks(data);
      $('empty').hidden = data.length > 0;
      $('pager').hidden = meta.total_pages <= 1;
      $('page-info').textContent = `Halaman ${meta.page} dari ${meta.total_pages}`;
      $('prev').disabled = meta.page <= 1;
      $('next').disabled = meta.page >= meta.total_pages;
    } catch (e) {
      banner(e.message);
    } finally {
      $('loading').hidden = true;
    }
  }

  function renderTasks(tasks) {
    const isTeacher = state.user.role === 'teacher';
    $('task-list').replaceChildren(
      ...tasks.map((t) => {
        const overdue = new Date(t.due_date) < new Date() && !t.completed;
        const meta = el('div', { class: 'meta' }, `Kelas ${t.class_name} · Tenggat ${fmtDate(t.due_date)}`);
        if (overdue) meta.append(' ', el('span', { class: 'late', textContent: '· Lewat tenggat' }));
        if (isTeacher) meta.append(` · ${t.completed_count}/${t.student_count} siswa selesai`);

        const info = el('div', {},
          el('h3', { class: 'task-title', textContent: t.title }),
          ...(t.description ? [el('p', { class: 'task-desc', textContent: t.description })] : []),
          meta);

        const actions = el('div', { class: 'task-actions' });
        const detail = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', textContent: 'Lihat detail' });
        detail.addEventListener('click', () => showTaskDetail(t));
        actions.append(detail);
        if (isTeacher) {
          const edit = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', textContent: 'Ubah' });
          edit.addEventListener('click', () => showTaskForm(t));
          const del = el('button', { class: 'btn btn-danger btn-sm', type: 'button', textContent: 'Hapus' });
          del.addEventListener('click', () => deleteTask(t, del));
          actions.append(edit, del);
        } else {
          const toggle = el('button', {
            class: t.completed ? 'btn btn-ghost btn-sm' : 'btn btn-sm',
            type: 'button',
            textContent: t.completed ? 'Batalkan selesai' : 'Tandai selesai',
          });
          toggle.addEventListener('click', () => toggleComplete(t, toggle));
          actions.append(toggle);
        }
        return el('li', { class: `task${t.completed ? ' done' : ''}` }, info, actions);
      })
    );
  }

  async function showTaskDetail(task) {
    const dialog = $('task-detail');
    try {
      const { data } = await api('GET', `/tasks/${task.id}`);
      $('detail-title').textContent = data.title;
      $('detail-description').textContent = data.description || 'Tidak ada deskripsi.';
      $('detail-class').textContent = data.class_name;
      $('detail-due').textContent = fmtDate(data.due_date);
      $('detail-status').textContent = state.user.role === 'teacher' ? 'Aktif' : (data.completed ? 'Selesai' : 'Belum selesai');
      const progress = state.user.role === 'teacher' ? `${data.completed_count ?? task.completed_count ?? 0}/${data.student_count ?? task.student_count ?? 0} siswa selesai` : '';
      $('detail-progress-wrap').hidden = state.user.role !== 'teacher';
      $('detail-progress').textContent = progress;
      dialog.showModal();
    } catch (e) { banner(e.message); }
  }

  $('detail-close').addEventListener('click', () => $('task-detail').close());
  $('task-detail').addEventListener('click', (e) => { if (e.target === $('task-detail')) $('task-detail').close(); });

  const toggleComplete = (t, btn) =>
    withBusy(btn, async () => {
      await api(t.completed ? 'DELETE' : 'POST', `/tasks/${t.id}/complete`);
      await loadTasks();
    });

  const deleteTask = (t, btn) =>
    withBusy(btn, async () => {
      if (!window.confirm(`Hapus tugas "${t.title}"?`)) return;
      await api('DELETE', `/tasks/${t.id}`);
      banner('Tugas dihapus.', 'success');
      await loadTasks();
    });

  // ---------- task form (guru) ----------
  function showTaskForm(task) {
    const f = $('form-task');
    state.editingId = task ? task.id : null;
    $('task-form-title').textContent = task ? 'Ubah tugas' : 'Tugas baru';
    f.title.value = task ? task.title : '';
    f.description.value = task ? task.description : '';
    f.due_date.value = task ? toLocalInput(task.due_date) : '';
    f.class_id.value = task ? task.class_id : (state.classes[0] && state.classes[0].id) || '';
    f.hidden = false;
    f.title.focus();
  }
  function hideTaskForm() {
    $('form-task').hidden = true;
    state.editingId = null;
  }

  $('btn-new').addEventListener('click', () => showTaskForm(null));
  $('task-cancel').addEventListener('click', hideTaskForm);
  $('form-task').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    clearBanner();
    if (!f.title.value.trim()) return banner('Judul wajib diisi.');
    if (!f.due_date.value) return banner('Tenggat wajib diisi.');
    const body = {
      title: f.title.value.trim(),
      description: f.description.value.trim(),
      due_date: new Date(f.due_date.value).toISOString(),
      class_id: Number(f.class_id.value),
    };
    withBusy($('task-submit'), async () => {
      if (state.editingId) await api('PUT', `/tasks/${state.editingId}`, body);
      else await api('POST', '/tasks', body);
      banner(state.editingId ? 'Tugas diperbarui.' : 'Tugas dibuat.', 'success');
      hideTaskForm();
      await loadTasks();
    });
  });

  // ---------- filter & paginasi ----------
  let searchTimer;
  $('f-search').addEventListener('input', () => {
    clearTimeout(searchTimer); // debounce agar tidak menembak API tiap ketukan
    searchTimer = setTimeout(() => { state.page = 1; loadTasks(); }, 350);
  });
  $('f-status').addEventListener('change', () => { state.page = 1; loadTasks(); });
  $('prev').addEventListener('click', () => { state.page -= 1; loadTasks(); });
  $('next').addEventListener('click', () => { state.page += 1; loadTasks(); });

  // ---------- auth forms ----------
  function setTab(login) {
    $('tab-login').classList.toggle('active', login);
    $('tab-register').classList.toggle('active', !login);
    $('form-login').hidden = !login;
    $('form-register').hidden = login;
    clearBanner();
  }
  $('tab-login').addEventListener('click', () => setTab(true));
  $('tab-register').addEventListener('click', () => setTab(false));

  const roleSelect = $('form-register').role;
  roleSelect.addEventListener('change', () => {
    const teacher = roleSelect.value === 'teacher';
    $('reg-class-wrap').hidden = teacher;
    $('reg-invite-wrap').hidden = !teacher;
  });

  $('form-login').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    clearBanner();
    if (!f.email.value.trim() || !f.password.value) return banner('Email dan password wajib diisi.');
    withBusy(f.querySelector('button'), async () => {
      const { data } = await api('POST', '/auth/login', { email: f.email.value.trim(), password: f.password.value });
      f.reset();
      setToken(data.token);
      enterApp(data.user);
    });
  });

  $('form-register').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    clearBanner();
    const body = { name: f.name.value.trim(), email: f.email.value.trim(), password: f.password.value, role: f.role.value };
    if (!body.name || !body.email || !body.password) return banner('Nama, email, dan password wajib diisi.');
    if (body.role === 'student') body.class_id = Number(f.class_id.value);
    else body.invite_code = f.invite_code.value;
    withBusy(f.querySelector('button'), async () => {
      const { data } = await api('POST', '/auth/register', body);
      f.reset();
      setToken(data.token);
      enterApp(data.user);
    });
  });

  $('logout').addEventListener('click', () => logout(true));

  // ---------- init ----------
  (async function init() {
    try { await loadClasses(); } catch (e) { banner(e.message); }
    if (getToken()) {
      try {
        const { data } = await api('GET', '/auth/me');
        return enterApp(data.user);
      } catch { setToken(null); }
    }
    showView('auth');
  })();
})();
