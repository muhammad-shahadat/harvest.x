import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { errorMessage, formatDate } from '../i18n';

const ROLES = ['general_user', 'farmer', 'buyer', 'operator', 'admin'];
const STATUSES = ['active', 'suspended', 'banned'];

// Admin: find users, suspend / ban / reinstate (FR-2, FR-36). Every action asks for a reason and is audited.
export default function AdminUsers() {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const [filters, setFilters] = useState({ q: '', role: '', status: '' });
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    api(`/api/admin/users?${p}`).then((d) => setRows(d.users)).catch((e) => setError(errorMessage(e)));
  };
  useEffect(() => { load(); }, [filters.role, filters.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (u, action) => {
    let reason;
    if (action !== 'reinstate') {
      reason = window.prompt(t('admin.reasonPrompt'));
      if (!reason || reason.trim().length < 3) return;
    }
    setError('');
    try { await api(`/api/admin/users/${u.id}/${action}`, { method: 'POST', body: { reason } }); load(); } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <div>
      <div className="page-head"><h1>{t('admin.users')}</h1></div>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <input placeholder={t('admin.searchHint')} value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}>
          <option value="">{t('admin.allRoles')}</option>{ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">{t('admin.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`accountStatus.${s}`)}</option>)}</select>
        <button className="btn" type="submit">{t('admin.search')}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {rows === null && <p className="loading">{t('common.loading')}</p>}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('admin.name')}</th><th>{t('admin.role')}</th><th>{t('apply.status')}</th><th>{t('admin.lastLogin')}</th><th /></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>{u.fullName}<br /><span className="muted">{u.email}</span></td>
                  <td>{t(`role.${u.role}`)}</td>
                  <td><span className={`badge badge-${u.status === 'active' ? 'approved' : 'rejected'}`}>{t(`accountStatus.${u.status}`)}</span>
                    {u.statusReason && <div className="muted">{u.statusReason}</div>}</td>
                  <td>{formatDate(u.lastLoginAt)}</td>
                  <td>
                    {u.id !== me.id && u.role !== 'admin' && (
                      <div className="row">
                        {u.status === 'active' && <button className="btn btn-small" onClick={() => act(u, 'suspend')}>{t('admin.suspend')}</button>}
                        {u.status !== 'banned' && <button className="btn btn-small btn-danger" onClick={() => act(u, 'ban')}>{t('admin.ban')}</button>}
                        {u.status !== 'active' && <button className="btn btn-small btn-primary" onClick={() => act(u, 'reinstate')}>{t('admin.reinstate')}</button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
