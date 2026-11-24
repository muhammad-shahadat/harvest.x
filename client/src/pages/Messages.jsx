import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { errorMessage, formatDate } from '../i18n';
import { formatNumber, pick } from '../format';

// FR-13: inbox = all my chats (as buyer or as farmer), newest first.
export default function Messages() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => api('/api/conversations').then((d) => setRows(d.conversations)).catch((e) => setError(errorMessage(e)));
    load();
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div>
      <div className="page-head"><h1>{t('chat.inboxTitle')}</h1></div>
      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p className="loading">{t('common.loading')}</p>}
      {rows && rows.length === 0 && (
        <div className="empty">
          <p>💬 {user.role === 'buyer' ? t('chat.inboxEmptyBuyer') : t('chat.inboxEmptyFarmer')}</p>
          {user.role === 'buyer' && <Link className="btn btn-primary" to="/search">{t('chat.browse')}</Link>}
        </div>
      )}
      {rows && rows.length > 0 && (
        <ul className="inbox">
          {rows.map((c) => (
            <li key={c.id}>
              <Link to={`/messages/${c.id}`} className={`inbox-row ${c.unread ? 'unread' : ''}`}>
                <span className="avatar" aria-hidden="true">{c.otherName.trim().charAt(0).toUpperCase()}</span>
                <span className="inbox-main">
                  <span className="inbox-top"><strong>{c.otherName}</strong><span className="muted small">{formatDate(c.lastMessageAt || c.createdAt)}</span></span>
                  <span className="muted small">{pick(c, 'cropName')}{c.variety ? ` · ${c.variety}` : ''}</span>
                  <span className="inbox-last">{c.lastMessage ? `${c.lastMessage.mine ? `${t('chat.you')}: ` : ''}${c.lastMessage.body}` : t('chat.noMessages')}</span>
                </span>
                {c.unread > 0 && <span className="count-badge" aria-label={t('chat.unreadBadge', { n: formatNumber(c.unread) })}>{formatNumber(c.unread)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
