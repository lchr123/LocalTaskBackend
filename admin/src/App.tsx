import React, { useState, useEffect } from 'react';

const API_BASE = '/api/admin';

// Inject table cell styles globally
const globalStyle = document.createElement('style');
globalStyle.textContent = `
  table th, table td {
    padding: 10px 12px;
    border-bottom: 1px solid #eee;
    border-right: 1px solid #f0f0f0;
    text-align: left;
  }
  table th {
    background: #fafafa;
    font-weight: 600;
    border-bottom: 2px solid #ddd;
  }
  table th:last-child, table td:last-child {
    border-right: none;
  }
  table tr:hover td {
    background: #f9f9f9;
  }
`;
document.head.appendChild(globalStyle);

function getToken(): string | null {
  return localStorage.getItem('admin_token');
}

function setToken(token: string) {
  localStorage.setItem('admin_token', token);
}

function clearToken() {
  localStorage.removeItem('admin_token');
}

async function apiRequest(path: string, options: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error('未授权');
  }
  return res.json();
}

// ─── Login Page ──────────────────────────────────────────────────────────────

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiRequest('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      if (data.token) {
        setToken(data.token);
        onLogin();
      } else {
        setError(data.message || '登录失败');
      }
    } catch {
      setError('登录失败，请检查网络');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.loginContainer}>
      <form onSubmit={handleSubmit} style={styles.loginForm}>
        <h2 style={{ textAlign: 'center', marginBottom: 24 }}>🔐 管理后台</h2>
        {error && <p style={styles.error}>{error}</p>}
        <input
          type="text"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={styles.input}
        />
        <input
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
        />
        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

// ─── Tag dictionary manager (task_tags & helper_tags) ────────────────────────

function TagsManager() {
  const [kind, setKind] = useState<'task' | 'helper'>('task');
  const [tags, setTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // New tag form
  const [newName, setNewName] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState('');

  // Inline edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [editCategory, setEditCategory] = useState('');

  const loadTags = async (k: 'task' | 'helper') => {
    setLoading(true);
    try {
      const result = await apiRequest(`/tags?kind=${k}`);
      setTags(result.tags || []);
    } catch {
      setTags([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTags(kind);
    // reset forms when switching dictionary
    setEditId(null);
    setNewName('');
    setNewLabel('');
    setNewCategory('');
  }, [kind]);

  const handleCreate = async () => {
    if (!newName.trim() || !newLabel.trim()) {
      alert('name 和 中文名 必填');
      return;
    }
    try {
      const res = await apiRequest(`/tags?kind=${kind}`, {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          label_zh: newLabel.trim(),
          category: newCategory.trim() || null,
        }),
      });
      if (res?.error) {
        alert(res.message || '创建失败');
        return;
      }
      setNewName('');
      setNewLabel('');
      setNewCategory('');
      loadTags(kind);
    } catch {
      alert('创建失败');
    }
  };

  const startEdit = (t: any) => {
    setEditId(t.id);
    setEditName(t.name);
    setEditLabel(t.label_zh);
    setEditCategory(t.category || '');
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim() || !editLabel.trim()) {
      alert('name 和 中文名 必填');
      return;
    }
    try {
      const res = await apiRequest(`/tags/${id}?kind=${kind}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName.trim(),
          label_zh: editLabel.trim(),
          category: editCategory.trim() || null,
        }),
      });
      if (res?.error) {
        alert(res.message || '保存失败');
        return;
      }
      setEditId(null);
      loadTags(kind);
    } catch {
      alert('保存失败');
    }
  };

  const handleDelete = async (t: any) => {
    const usage = t.usage_count || 0;
    const warn =
      usage > 0
        ? `标签「${t.label_zh}」当前被 ${usage} 个${kind === 'task' ? '任务' : '用户'}使用，删除后这些关联也会移除。确定删除？`
        : `确定删除标签「${t.label_zh}」？`;
    if (!confirm(warn)) return;
    try {
      await apiRequest(`/tags/${t.id}?kind=${kind}`, { method: 'DELETE' });
      loadTags(kind);
    } catch {
      alert('删除失败');
    }
  };

  return (
    <div style={{ padding: 16 }}>
      {/* Dictionary switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setKind('task')}
          style={{ ...styles.navBtn, ...(kind === 'task' ? styles.navBtnActive : {}) }}
        >
          📋 任务标签
        </button>
        <button
          onClick={() => setKind('helper')}
          style={{ ...styles.navBtn, ...(kind === 'helper' ? styles.navBtnActive : {}) }}
        >
          👤 帮手标签
        </button>
      </div>

      {/* New tag form */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="name (英文唯一标识, 如 weekend)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{ ...styles.searchInput, width: 220 }}
        />
        <input
          type="text"
          placeholder="中文名 (如 周末)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          style={{ ...styles.searchInput, width: 160 }}
        />
        <input
          type="text"
          placeholder="分类 (可选, 如 scene)"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          style={{ ...styles.searchInput, width: 160 }}
        />
        <button onClick={handleCreate} style={styles.detailBtn}>+ 新增标签</button>
      </div>

      {loading ? (
        <p style={{ textAlign: 'center', padding: 40 }}>加载中...</p>
      ) : (
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>name</th><th>中文名</th><th>分类</th><th>使用数</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((t: any) => (
                <tr key={t.id}>
                  {editId === t.id ? (
                    <>
                      <td><input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ ...styles.searchInput, width: 160 }} /></td>
                      <td><input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} style={{ ...styles.searchInput, width: 120 }} /></td>
                      <td><input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} style={{ ...styles.searchInput, width: 120 }} /></td>
                      <td>{t.usage_count ?? 0}</td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => handleSaveEdit(t.id)} style={styles.detailBtn}>保存</button>
                        <button onClick={() => setEditId(null)} style={styles.select}>取消</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{t.name}</td>
                      <td>{t.label_zh}</td>
                      <td>{t.category || '-'}</td>
                      <td>{t.usage_count ?? 0}</td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => startEdit(t)} style={styles.detailBtn}>编辑</button>
                        <button onClick={() => handleDelete(t)} style={{ ...styles.detailBtn, background: '#d32f2f', color: '#fff', borderColor: '#d32f2f' }}>删除</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {tags.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#999' }}>暂无标签</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Marketplace draft from a Xiaohongshu (小红书) post ──────────────────────

const ITEM_CATEGORY_LABELS_ADMIN: Record<string, string> = {
  electronics: '电子产品',
  furniture: '家具家电',
  clothing: '服饰鞋包',
  books: '图书文具',
  other: '其他',
};

function MarketplaceDraftManager() {
  const [url, setUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [scrapeError, setScrapeError] = useState('');
  const [source, setSource] = useState<any>(null);

  // Editable draft fields — pre-filled from the AI draft, but the admin can
  // (and should) review/adjust everything before publishing.
  const [type, setType] = useState('other');
  const [description, setDescription] = useState('');
  const [reward, setReward] = useState('');
  const [contactMethod, setContactMethod] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [deadline, setDeadline] = useState(() => {
    // Default to +90 days: marketplace listings don't have a natural
    // deadline concept, but tasks.deadline is NOT NULL and drives
    // auto-cancellation, so we need a far-future placeholder.
    const d = new Date();
    d.setDate(d.getDate() + 90);
    return d.toISOString().slice(0, 16);
  });
  const [publishResult, setPublishResult] = useState<any>(null);

  const handleScrape = async () => {
    if (!url.trim()) {
      alert('请输入小红书笔记链接');
      return;
    }
    setScraping(true);
    setScrapeError('');
    setPublishResult(null);
    try {
      const res = await apiRequest('/marketplace-draft/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: url.trim() }),
      });
      if (res?.error) {
        setScrapeError(res.message || '抓取失败');
        return;
      }
      setType(res.draft.type);
      setDescription(res.draft.description || '');
      setReward(res.draft.reward != null ? String(res.draft.reward) : '');
      setContactMethod(res.draft.contactMethod || '');
      setImages(res.draft.images || []);
      setSource(res.source);
    } catch {
      setScrapeError('抓取失败，请检查网络或稍后重试');
    } finally {
      setScraping(false);
    }
  };

  const handlePublish = async () => {
    if (!description.trim() || description.trim().length < 10) {
      alert('商品描述至少需要10个字符，请检查/补充');
      return;
    }
    if (!reward || isNaN(Number(reward))) {
      alert('请填写有效的价格');
      return;
    }
    if (images.length === 0) {
      alert('二手商品至少需要1张图片，请补充');
      return;
    }
    if (!address.trim() || !latitude || !longitude) {
      alert('请填写地点（地址 + 经纬度）');
      return;
    }

    setPublishing(true);
    try {
      const res = await apiRequest('/marketplace-draft/publish', {
        method: 'POST',
        body: JSON.stringify({
          type,
          description: description.trim(),
          reward: Number(reward),
          contactMethod: contactMethod.trim() || null,
          images,
          location: {
            address: address.trim(),
            latitude: Number(latitude),
            longitude: Number(longitude),
          },
          deadline: new Date(deadline).toISOString(),
        }),
      });
      if (res?.error) {
        alert(res.message || '发布失败');
        return;
      }
      setPublishResult(res);
      alert('发布成功！');
    } catch {
      alert('发布失败，请稍后重试');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <p style={{ fontSize: 13, color: '#757575', marginBottom: 16, lineHeight: 1.6 }}>
        输入你自己在小红书发布过的笔记链接，AI 会自动提取文案和图片并整理成商品草稿。
        <strong> 请在发布前仔细核对以下所有字段</strong>，AI 提取的内容可能不准确或不完整。
      </p>

      {/* Step 1: URL input */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="https://www.xiaohongshu.com/explore/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ ...styles.searchInput, flex: 1, width: 'auto' }}
        />
        <button onClick={handleScrape} disabled={scraping} style={styles.detailBtn}>
          {scraping ? '抓取中...' : '🔍 抓取并生成草稿'}
        </button>
      </div>

      {scrapeError && (
        <p style={{ color: '#d32f2f', fontSize: 13, marginBottom: 16 }}>{scrapeError}</p>
      )}

      {source && (
        <div style={{ background: '#F5F5F5', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12, color: '#666' }}>
          <div>来源作者：{source.authorName || '未提取到'}</div>
          <div>原文标题：{source.rawTitle || '未提取到'}</div>
          <div>图片：抓到 {source.imageCount} 张，成功转存 {source.reuploadedImageCount} 张</div>
        </div>
      )}

      {/* Step 2: editable draft form */}
      {source && (
        <div style={{ background: '#fff', border: '1px solid #E0E0E0', borderRadius: 8, padding: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>草稿（发布前请检查）</h3>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>商品分类</label>
            <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...styles.select, width: '100%', padding: 8 }}>
              {Object.entries(ITEM_CATEGORY_LABELS_ADMIN).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>商品描述 *（10-500字符）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box' as any }}
            />
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>价格（円） *</label>
              <input
                type="number"
                value={reward}
                onChange={(e) => setReward(e.target.value)}
                placeholder="AI 未提取到价格时需手动填写"
                style={{ ...styles.searchInput, width: '100%' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>联系方式（可选）</label>
              <input
                type="text"
                value={contactMethod}
                onChange={(e) => setContactMethod(e.target.value)}
                style={{ ...styles.searchInput, width: '100%' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>地点 *</label>
            <input
              type="text"
              placeholder="地址"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              style={{ ...styles.searchInput, width: '100%', marginBottom: 6 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="纬度 latitude"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                style={{ ...styles.searchInput, flex: 1, width: 'auto' }}
              />
              <input
                type="text"
                placeholder="经度 longitude"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                style={{ ...styles.searchInput, flex: 1, width: 'auto' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>失效时间（到期后自动下架，默认90天后）</label>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              style={{ ...styles.searchInput, width: '100%' }}
            />
          </div>

          {images.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>商品图片（{images.length}张，已转存到自有存储）</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {images.map((imgUrl, i) => (
                  <img key={i} src={imgUrl} alt={`商品图片 ${i + 1}`} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid #ddd' }} />
                ))}
              </div>
            </div>
          )}

          <button onClick={handlePublish} disabled={publishing} style={{ ...styles.detailBtn, background: '#1976d2', color: '#fff', padding: '10px 20px' }}>
            {publishing ? '发布中...' : '✅ 确认并发布'}
          </button>
        </div>
      )}

      {publishResult && (
        <div style={{ marginTop: 16, background: '#E8F5E9', borderRadius: 8, padding: 12, fontSize: 13 }}>
          ✅ 已发布，任务 ID：{publishResult.id}
        </div>
      )}
    </div>
  );
}

function Dashboard() {
  const [tab, setTab] = useState<'users' | 'tasks' | 'reports' | 'chats' | 'reviews' | 'bans' | 'tags' | 'marketplace-draft'>('users');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [selectedChat, setSelectedChat] = useState<any>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [selectedReview, setSelectedReview] = useState<any>(null);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [banDialogUser, setBanDialogUser] = useState<any>(null);
  const [banReason, setBanReason] = useState('');
  const [banDuration, setBanDuration] = useState('permanent');

  useEffect(() => {
    loadData();
  }, [tab, page, statusFilter, searchQuery]);

  const loadData = async () => {
    // The tags tab manages its own data via the TagsManager component.
    if (tab === 'tags') {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (statusFilter) {
        if (tab === 'bans') {
          params.set('active', statusFilter);
        } else {
          params.set('status', statusFilter);
        }
      }
      if ((tab === 'tasks' || tab === 'users' || tab === 'chats') && searchQuery) params.set('search', searchQuery);
      const result = await apiRequest(`/${tab}?${params}`);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const loadChatMessages = async (chat: any) => {
    setSelectedChat(chat);
    setLoadingMessages(true);
    try {
      const result = await apiRequest(`/chats/${chat.id}/messages`);
      setChatMessages(result.messages || []);
    } catch {
      setChatMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleBanSubmit = async () => {
    if (!banDialogUser || !banReason.trim()) return;
    try {
      let expiresAt: string | null = null;
      if (banDuration !== 'permanent') {
        const days = parseInt(banDuration);
        const date = new Date();
        date.setDate(date.getDate() + days);
        expiresAt = date.toISOString();
      }
      await apiRequest(`/users/${banDialogUser.id}/ban`, {
        method: 'POST',
        body: JSON.stringify({ reason: banReason.trim(), expiresAt }),
      });
      setBanDialogUser(null);
      setBanReason('');
      setBanDuration('permanent');
      alert('封禁成功');
      loadData();
    } catch {
      alert('封禁失败');
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    if (!confirm(`确定将状态改为「${newStatus}」？`)) return;
    try {
      if (tab === 'tasks') {
        await apiRequest(`/tasks/${id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: newStatus }),
        });
      } else if (tab === 'reports') {
        await apiRequest(`/reports/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: newStatus }),
        });
      }
      loadData();
    } catch {
      alert('操作失败');
    }
  };

  const TASK_TYPE_LABELS: Record<string, string> = {
    full_time: '全职',
    part_time: '兼职',
    one_time: '单次任务',
  };

  const handleTypeChange = async (id: string, newType: string) => {
    if (!confirm(`确定将类型改为「${TASK_TYPE_LABELS[newType] || newType}」？`)) return;
    try {
      await apiRequest(`/tasks/${id}/type`, {
        method: 'PATCH',
        body: JSON.stringify({ type: newType }),
      });
      loadData();
    } catch {
      alert('操作失败');
    }
  };

  const handleToggleEmailOptIn = async (u: any) => {
    const next = !u.email_opt_in;
    if (!confirm(`确定将「${u.nickname || u.cognito_sub || '该用户'}」的邮件订阅设为${next ? '开启' : '关闭'}？`)) return;
    try {
      const res = await apiRequest(`/users/${u.id}/email-opt-in`, {
        method: 'PATCH',
        body: JSON.stringify({ emailOptIn: next }),
      });
      if (res?.error) {
        alert(res.message || '操作失败');
        return;
      }
      // Keep the open detail modal in sync if it shows this user.
      setSelectedUser((prev: any) => (prev && prev.id === u.id ? { ...prev, email_opt_in: next } : prev));
      loadData();
    } catch {
      alert('操作失败');
    }
  };

  const handleLogout = () => {
    clearToken();
    window.location.reload();
  };
  return (
    <div style={styles.dashboard}>
      <header style={styles.header}>
        <h1 style={{ margin: 0, fontSize: 18 }}>LocallyHelper 管理后台</h1>
        <button onClick={handleLogout} style={styles.logoutBtn}>退出</button>
      </header>

      <nav style={styles.nav}>
        {(['users', 'tasks', 'reports', 'chats', 'reviews', 'bans', 'tags', 'marketplace-draft'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); setStatusFilter(''); setSearchQuery(''); }}
            style={{ ...styles.navBtn, ...(tab === t ? styles.navBtnActive : {}) }}
          >
            {{ users: '👤 用户', tasks: '📋 任务', reports: '🚨 投诉', chats: '💬 对话', reviews: '⭐ 评价', bans: '🚫 封禁', tags: '🏷️ 标签', 'marketplace-draft': '🤖 AI 商品草稿' }[t]}
          </button>
        ))}
      </nav>

      {tab === 'tags' && <TagsManager />}
      {tab === 'marketplace-draft' && <MarketplaceDraftManager />}

      {tab === 'users' && (
        <div style={styles.filters}>
          <input
            type="text"
            placeholder="搜索 Cognito Sub..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            style={styles.searchInput}
          />
        </div>
      )}

      {tab === 'tasks' && (
        <div style={styles.filters}>
          <input
            type="text"
            placeholder="搜索任务 ID..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            style={styles.searchInput}
          />
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={styles.select}>
            <option value="">全部状态</option>
            <option value="open">待接单</option>
            <option value="in_progress">进行中</option>
            <option value="completed">已完成</option>
            <option value="cancelled">已取消</option>
          </select>
        </div>
      )}

      {tab === 'reports' && (
        <div style={styles.filters}>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={styles.select}>
            <option value="">全部状态</option>
            <option value="submitted">待处理</option>
            <option value="reviewing">处理中</option>
            <option value="resolved">已处理</option>
          </select>
        </div>
      )}

      {tab === 'chats' && (
        <div style={styles.filters}>
          <input
            type="text"
            placeholder="搜索 Poster Cognito Sub..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            style={styles.searchInput}
          />
        </div>
      )}

      {tab === 'bans' && (
        <div style={styles.filters}>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={styles.select}>
            <option value="">全部</option>
            <option value="true">生效中</option>
            <option value="false">已解除</option>
          </select>
        </div>
      )}

      {loading ? (
        <p style={{ textAlign: 'center', padding: 40 }}>加载中...</p>
      ) : (
        <div style={styles.tableContainer}>
          {tab === 'users' && data?.users && (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>Cognito Sub</th><th>昵称</th><th>邮箱</th><th>手机</th><th>邮件订阅</th><th>注册时间</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u: any) => (
                  <tr key={u.id}>
                    <td style={styles.idCell}>{u.cognito_sub || '-'}</td>
                    <td>{u.nickname || '-'}</td>
                    <td>{u.email || '-'}</td>
                    <td>{u.phone || '-'}</td>
                    <td>
                      <span style={{ ...styles.badge, backgroundColor: u.email_opt_in ? '#4caf50' : '#9e9e9e' }}>
                        {u.email_opt_in ? '订阅中' : '已退订'}
                      </span>
                    </td>
                    <td>{new Date(u.created_at).toLocaleString('ja-JP', { hour12: false })}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setSelectedUser(u)} style={styles.detailBtn}>查看详细</button>
                      <button onClick={() => handleToggleEmailOptIn(u)} style={styles.detailBtn}>
                        {u.email_opt_in ? '关闭订阅' : '开启订阅'}
                      </button>
                      <button onClick={() => setBanDialogUser(u)} style={{ ...styles.detailBtn, borderColor: '#f44336', color: '#f44336' }}>封禁</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'tasks' && data?.tasks && (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>发布者</th><th>类型</th><th>描述</th><th>报酬</th><th>状态</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((t: any) => (
                  <tr key={t.id}>
                    <td>{t.poster_nickname}</td>
                    <td>{TASK_TYPE_LABELS[t.type] || t.type}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</td>
                    <td>¥{t.reward}</td>
                    <td><span style={{ ...styles.badge, backgroundColor: statusColor(t.status) }}>{statusLabel(t.status)}</span></td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setSelectedTask(t)} style={styles.detailBtn}>查看详情</button>
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) handleTypeChange(t.id, e.target.value); }}
                        style={styles.select}
                      >
                        <option value="">修改类型</option>
                        <option value="full_time">全职</option>
                        <option value="part_time">兼职</option>
                        <option value="one_time">单次任务</option>
                      </select>
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) handleStatusChange(t.id, e.target.value); }}
                        style={styles.select}
                      >
                        <option value="">修改状态</option>
                        <option value="open">待接单</option>
                        <option value="in_progress">进行中</option>
                        <option value="completed">已完成</option>
                        <option value="cancelled">已取消</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Task Detail Modal */}
          {selectedTask && (
            <div style={styles.modalOverlay} onClick={() => setSelectedTask(null)}>
              <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <h3 style={{ margin: 0 }}>任务详情</h3>
                  <button onClick={() => setSelectedTask(null)} style={styles.closeBtn}>✕</button>
                </div>
                <div style={styles.modalBody}>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>任务 ID</span><span style={styles.detailValue}>{selectedTask.id}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>发布者</span><span style={styles.detailValue}>{selectedTask.poster_nickname} ({selectedTask.poster_email || '-'})</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>发布者 ID</span><span style={styles.detailValue}>{selectedTask.poster_id}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>类型</span><span style={styles.detailValue}>{TASK_TYPE_LABELS[selectedTask.type] || selectedTask.type}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>状态</span><span style={styles.detailValue}><span style={{ ...styles.badge, backgroundColor: statusColor(selectedTask.status) }}>{statusLabel(selectedTask.status)}</span></span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>描述</span><span style={styles.detailValue}>{selectedTask.description}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>地址</span><span style={styles.detailValue}>{selectedTask.location_address || '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>报酬</span><span style={styles.detailValue}>¥{selectedTask.reward}{selectedTask.reward_unit ? ` / ${({ once: '次', hour: '小时', day: '日', month: '月' } as any)[selectedTask.reward_unit] || selectedTask.reward_unit}` : ''}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>截止时间</span><span style={styles.detailValue}>{selectedTask.deadline ? new Date(selectedTask.deadline).toLocaleString('ja-JP', { hour12: false }) : '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>预计开始</span><span style={styles.detailValue}>{selectedTask.start_time ? new Date(selectedTask.start_time).toLocaleString('ja-JP', { hour12: false }) : '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>预计时长</span><span style={styles.detailValue}>{selectedTask.duration_hours != null ? `${selectedTask.duration_hours} 小时${selectedTask.duration_unit ? ` / ${({ once: '次', day: '日', week: '周', month: '月' } as any)[selectedTask.duration_unit] || selectedTask.duration_unit}` : ''}` : '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>招募人数</span><span style={styles.detailValue}>{selectedTask.headcount ?? 1} 人</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>联系方式</span><span style={styles.detailValue}>{selectedTask.contact_method || '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>坐标</span><span style={styles.detailValue}>{selectedTask.latitude != null && selectedTask.longitude != null ? `${Number(selectedTask.latitude).toFixed(5)}, ${Number(selectedTask.longitude).toFixed(5)}` : '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>发布者备注</span><span style={styles.detailValue}>{selectedTask.poster_memo || '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>意向人数</span><span style={styles.detailValue}>{selectedTask.intent_count}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>选中帮手 ID</span><span style={styles.detailValue}>{selectedTask.selected_helper_id || '-'}</span></div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>任务图片</span>
                    <span style={styles.detailValue}>
                      {Array.isArray(selectedTask.images) && selectedTask.images.length > 0 ? (
                        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {selectedTask.images.map((url: string, i: number) => (
                            <img
                              key={i}
                              src={url}
                              alt={`task-img-${i}`}
                              onClick={() => window.open(url, '_blank')}
                              style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '1px solid #ddd' }}
                            />
                          ))}
                        </span>
                      ) : '-'}
                    </span>
                  </div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>创建时间</span><span style={styles.detailValue}>{new Date(selectedTask.created_at).toLocaleString('ja-JP', { hour12: false })}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>更新时间</span><span style={styles.detailValue}>{selectedTask.updated_at ? new Date(selectedTask.updated_at).toLocaleString('ja-JP', { hour12: false }) : '-'}</span></div>
                </div>
              </div>
            </div>
          )}

          {/* Chat Messages Modal */}
          {selectedChat && (
            <div style={styles.modalOverlay} onClick={() => setSelectedChat(null)}>
              <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <h3 style={{ margin: 0 }}>对话记录</h3>
                  <button onClick={() => setSelectedChat(null)} style={styles.closeBtn}>✕</button>
                </div>
                <div style={styles.modalBody}>
                  {loadingMessages ? (
                    <p style={{ textAlign: 'center', padding: 20 }}>加载中...</p>
                  ) : chatMessages.length === 0 ? (
                    <p style={{ textAlign: 'center', padding: 20, color: '#999' }}>暂无消息记录</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {chatMessages.map((m: any) => (
                        <div key={m.id} style={{ padding: '8px 12px', borderRadius: 6, background: '#f5f5f5' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>{m.sender_nickname} ({m.sender_cognito_sub})</span>
                            <span style={{ fontSize: 11, color: '#999' }}>{new Date(m.timestamp).toLocaleString('ja-JP', { hour12: false })}</span>
                          </div>
                          {m.type === 'image' ? (
                            <img src={m.image_url} alt="图片" style={{ maxWidth: 200, borderRadius: 4 }} />
                          ) : (
                            <p style={{ margin: 0, fontSize: 13 }}>{m.content}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'reports' && data?.reports && (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>ID</th><th>举报人</th><th>类型</th><th>举报目标ID</th><th>描述</th><th>状态</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.reports.map((r: any) => (
                  <tr key={r.id}>
                    <td style={styles.idCell}>{r.id.slice(0, 8)}...</td>
                    <td>{r.reporter_nickname}</td>
                    <td>{r.type}</td>
                    <td>{r.target_id}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                    <td><span style={{ ...styles.badge, backgroundColor: reportStatusColor(r.status) }}>{reportStatusLabel(r.status)}</span></td>
                    <td>
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) handleStatusChange(r.id, e.target.value); }}
                        style={styles.select}
                      >
                        <option value="">处理</option>
                        <option value="submitted">标记待处理</option>
                        <option value="reviewing">标记处理中</option>
                        <option value="resolved">标记已处理</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'chats' && data?.chats && (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>任务 ID</th><th>Poster Cognito Sub</th><th>Helper Cognito Sub</th><th>创建时间</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.chats.map((c: any) => (
                  <tr key={c.id}>
                    <td style={styles.idCell}>{c.task_id}</td>
                    <td style={styles.idCell}>{c.poster_cognito_sub}</td>
                    <td style={styles.idCell}>{c.helper_cognito_sub}</td>
                    <td>{new Date(c.created_at).toLocaleString('ja-JP', { hour12: false })}</td>
                    <td><button onClick={() => loadChatMessages(c)} style={styles.detailBtn}>查看详细</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'reviews' && data?.reviews && (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>任务 ID</th><th>Reviewer Cognito Sub</th><th>Reviewee Cognito Sub</th><th>评分</th><th>创建时间</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.reviews.map((r: any) => (
                  <tr key={r.id}>
                    <td style={styles.idCell}>{r.task_id}</td>
                    <td style={styles.idCell}>{r.reviewer_cognito_sub}</td>
                    <td style={styles.idCell}>{r.reviewee_cognito_sub}</td>
                    <td>{'⭐'.repeat(r.rating)}</td>
                    <td>{new Date(r.created_at).toLocaleString('ja-JP', { hour12: false })}</td>
                    <td><button onClick={() => setSelectedReview(r)} style={styles.detailBtn}>查看详细</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Review Detail Modal */}
          {selectedReview && (
            <div style={styles.modalOverlay} onClick={() => setSelectedReview(null)}>
              <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <h3 style={{ margin: 0 }}>评价详情</h3>
                  <button onClick={() => setSelectedReview(null)} style={styles.closeBtn}>✕</button>
                </div>
                <div style={styles.modalBody}>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>任务 ID</span><span style={styles.detailValue}>{selectedReview.task_id}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>评价者</span><span style={styles.detailValue}>{selectedReview.reviewer_cognito_sub}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>被评价者</span><span style={styles.detailValue}>{selectedReview.reviewee_cognito_sub}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>评分</span><span style={styles.detailValue}>{'⭐'.repeat(selectedReview.rating)} ({selectedReview.rating}/5)</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>评论内容</span><span style={styles.detailValue}>{selectedReview.comment || '（无评论）'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>创建时间</span><span style={styles.detailValue}>{new Date(selectedReview.created_at).toLocaleString('ja-JP', { hour12: false })}</span></div>
                </div>
              </div>
            </div>
          )}

          {/* User Detail Modal */}
          {selectedUser && (
            <div style={styles.modalOverlay} onClick={() => setSelectedUser(null)}>
              <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <h3 style={{ margin: 0 }}>用户详情</h3>
                  <button onClick={() => setSelectedUser(null)} style={styles.closeBtn}>✕</button>
                </div>
                <div style={styles.modalBody}>
                  {selectedUser.avatar_url && (
                    <div style={{ textAlign: 'center', marginBottom: 12 }}>
                      <img src={selectedUser.avatar_url} alt="avatar" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '1px solid #ddd' }} />
                    </div>
                  )}
                  <div style={styles.detailRow}><span style={styles.detailLabel}>昵称</span><span style={styles.detailValue}>{selectedUser.nickname || '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>用户 ID</span><span style={styles.detailValue}>{selectedUser.id}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>Cognito Sub</span><span style={styles.detailValue}>{selectedUser.cognito_sub || '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>邮箱</span><span style={styles.detailValue}>{selectedUser.email || '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>手机</span><span style={styles.detailValue}>{selectedUser.phone || '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>性别</span><span style={styles.detailValue}>{({ male: '男', female: '女', other: '其他' } as any)[selectedUser.gender] || '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>生日</span><span style={styles.detailValue}>{selectedUser.birthday ? new Date(selectedUser.birthday).toLocaleDateString('ja-JP') : '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>住址</span><span style={styles.detailValue}>{selectedUser.address || '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>自我介绍</span><span style={styles.detailValue}>{selectedUser.bio || '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>评分</span><span style={styles.detailValue}>⭐ {selectedUser.average_rating ?? '-'}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>完成任务</span><span style={styles.detailValue}>{selectedUser.completed_task_count ?? 0} 个</span></div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>邮件订阅</span>
                    <span style={{ ...styles.detailValue, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ ...styles.badge, backgroundColor: selectedUser.email_opt_in ? '#4caf50' : '#9e9e9e' }}>
                        {selectedUser.email_opt_in ? '订阅中' : '已退订'}
                      </span>
                      <button onClick={() => handleToggleEmailOptIn(selectedUser)} style={styles.detailBtn}>
                        {selectedUser.email_opt_in ? '关闭订阅' : '开启订阅'}
                      </button>
                    </span>
                  </div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>注册时间</span><span style={styles.detailValue}>{new Date(selectedUser.created_at).toLocaleString('ja-JP', { hour12: false })}</span></div>
                  <div style={styles.detailRow}><span style={styles.detailLabel}>更新时间</span><span style={styles.detailValue}>{selectedUser.updated_at ? new Date(selectedUser.updated_at).toLocaleString('ja-JP', { hour12: false }) : '-'}</span></div>
                </div>
              </div>
            </div>
          )}

          {/* Ban Dialog */}
          {banDialogUser && (
            <div style={styles.modalOverlay} onClick={() => setBanDialogUser(null)}>
              <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <h3 style={{ margin: 0 }}>封禁用户</h3>
                  <button onClick={() => setBanDialogUser(null)} style={styles.closeBtn}>✕</button>
                </div>
                <div style={styles.modalBody}>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>用户</span>
                    <span style={styles.detailValue}>{banDialogUser.nickname || '-'} ({banDialogUser.cognito_sub})</span>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>封禁原因 *</label>
                    <textarea
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                      placeholder="请填写封禁原因..."
                      style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid #ddd', fontSize: 13, minHeight: 80, resize: 'vertical', boxSizing: 'border-box' as any }}
                    />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>封禁时长</label>
                    <select value={banDuration} onChange={(e) => setBanDuration(e.target.value)} style={{ ...styles.select, width: '100%', padding: 10 }}>
                      <option value="permanent">永久封禁</option>
                      <option value="1">1 天</option>
                      <option value="3">3 天</option>
                      <option value="7">7 天</option>
                      <option value="14">14 天</option>
                      <option value="30">30 天</option>
                      <option value="90">90 天</option>
                    </select>
                  </div>
                  <button
                    onClick={handleBanSubmit}
                    disabled={!banReason.trim()}
                    style={{ width: '100%', padding: 10, background: !banReason.trim() ? '#ccc' : '#f44336', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, cursor: banReason.trim() ? 'pointer' : 'not-allowed' }}
                  >
                    确认封禁
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'bans' && data?.bans && (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>用户昵称</th><th>Cognito Sub</th><th>原因</th><th>封禁时间</th><th>到期时间</th><th>状态</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.bans.map((b: any) => (
                  <tr key={b.id}>
                    <td>{b.nickname || '-'}</td>
                    <td style={styles.idCell}>{b.cognito_sub}</td>
                    <td>{b.reason}</td>
                    <td>{new Date(b.banned_at).toLocaleString('ja-JP', { hour12: false })}</td>
                    <td>{b.expires_at ? new Date(b.expires_at).toLocaleString('ja-JP', { hour12: false }) : '永久'}</td>
                    <td><span style={{ ...styles.badge, backgroundColor: b.is_active ? '#f44336' : '#4caf50' }}>{b.is_active ? '生效中' : '已解除'}</span></td>
                    <td>
                      {b.is_active && (
                        <button
                          onClick={async () => {
                            if (!confirm('确定解封该用户？')) return;
                            await apiRequest(`/users/${b.user_id}/unban`, { method: 'POST' });
                            loadData();
                          }}
                          style={styles.detailBtn}
                        >
                          解封
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Pagination */}
          {data && (
            <div style={styles.pagination}>
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={styles.pageBtn}>上一页</button>
              <span>第 {page} / {data.totalPages || 1} 页（共 {data.totalCount || 0} 条）</span>
              <button disabled={page >= (data.totalPages || 1)} onClick={() => setPage(page + 1)} style={styles.pageBtn}>下一页</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusLabel(s: string) {
  return { open: '待接单', in_progress: '进行中', completed: '已完成', cancelled: '已取消' }[s] || s;
}
function statusColor(s: string) {
  return { open: '#4caf50', in_progress: '#ff9800', completed: '#2196f3', cancelled: '#9e9e9e' }[s] || '#9e9e9e';
}
function reportStatusLabel(s: string) {
  return { submitted: '待处理', reviewing: '处理中', resolved: '已处理' }[s] || s;
}
function reportStatusColor(s: string) {
  return { submitted: '#ff9800', reviewing: '#2196f3', resolved: '#4caf50' }[s] || '#9e9e9e';
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(!!getToken());

  if (!isLoggedIn) {
    return <LoginPage onLogin={() => setIsLoggedIn(true)} />;
  }
  return <Dashboard />;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  loginContainer: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f5f5' },
  loginForm: { background: '#fff', padding: 32, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', width: 320 },
  input: { display: 'block', width: '100%', padding: '10px 12px', marginBottom: 12, border: '1px solid #ddd', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' },
  button: { display: 'block', width: '100%', padding: '10px 12px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, fontSize: 14, cursor: 'pointer' },
  error: { color: '#f44336', fontSize: 13, marginBottom: 12 },
  dashboard: { fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', minHeight: '100vh', background: '#f5f5f5' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', background: '#1976d2', color: '#fff' },
  logoutBtn: { background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer' },
  nav: { display: 'flex', gap: 0, borderBottom: '1px solid #ddd', background: '#fff' },
  navBtn: { padding: '12px 24px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, borderBottom: '2px solid transparent' },
  navBtnActive: { borderBottom: '2px solid #1976d2', color: '#1976d2', fontWeight: 600 },
  filters: { padding: '12px 24px', background: '#fff', borderBottom: '1px solid #eee', display: 'flex', gap: 12, alignItems: 'center' },
  select: { padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 },
  searchInput: { padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, width: 220 },
  tableContainer: { padding: 24 },
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', fontSize: 13, border: '1px solid #e0e0e0' },
  idCell: { fontFamily: 'monospace', fontSize: 11, color: '#888', padding: '10px 12px', borderBottom: '1px solid #eee', borderRight: '1px solid #eee' },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 12, color: '#fff', fontSize: 11, fontWeight: 600 },
  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, padding: '16px 0', fontSize: 13 },
  pageBtn: { padding: '6px 12px', border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer' },
  detailBtn: { padding: '4px 10px', border: '1px solid #1976d2', borderRadius: 4, background: '#fff', color: '#1976d2', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' as any },
  modalOverlay: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalContent: { background: '#fff', borderRadius: 8, width: '90%', maxWidth: 600, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #eee' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#666' },
  modalBody: { padding: '16px 24px' },
  detailRow: { display: 'flex', padding: '10px 0', borderBottom: '1px solid #f5f5f5' },
  detailLabel: { width: 120, flexShrink: 0, fontWeight: 600, color: '#555', fontSize: 13 },
  detailValue: { flex: 1, fontSize: 13, wordBreak: 'break-all' as any },
};
