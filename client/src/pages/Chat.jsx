import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { supabase } from '../supabase';
import { errorMessage, formatDate } from '../i18n';
import { pick } from '../format';
import ReportForm from '../components/ReportForm';

// FR-13: one chat between a buyer and a farmer about one listing.
// New messages arrive by Supabase Realtime (private channel "chat:<id>"). Every 8 seconds we also ask for newer messages,
// so chat keeps working when Realtime is blocked (some networks block websockets).
export default function Chat() {
  const { id } = useParams();
  const { t } = useTranslation();
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [report, setReport] = useState(null);      // null | { kind: 'user', conversationId } | { kind: 'message', messageId }
  const [menu, setMenu] = useState(false);
  const bottom = useRef(null);
  const lastId = useRef(0);
  const stick = useRef(true);                      // keep the view at the newest message unless the person scrolled up

  // add messages once (realtime, polling and our own send can deliver the same one)
  const merge = useCallback((incoming) => {
    setMessages((cur) => {
      const have = new Set(cur.map((m) => m.id));
      const fresh = incoming.filter((m) => !have.has(m.id));
      if (!fresh.length) return cur;
      return [...cur, ...fresh].sort((a, b) => a.id - b.id);
    });
  }, []);

  const loadNewer = useCallback(async () => {
    try {
      const d = await api(`/api/conversations/${id}?afterId=${lastId.current}`);
      setConv(d.conversation);
      if (d.messages.length) merge(d.messages);
      window.dispatchEvent(new Event('hx-unread'));
    } catch (_) { /* a short network problem: the next poll tries again */ }
  }, [id, merge]);

  useEffect(() => {
    let alive = true;
    setConv(null); setMessages([]); setError(''); setNote(''); lastId.current = 0; stick.current = true;
    api(`/api/conversations/${id}`).then((d) => {
      if (!alive) return;
      setConv(d.conversation); setMessages(d.messages); setHasMore(d.hasMore);
      window.dispatchEvent(new Event('hx-unread'));
    }).catch((e) => alive && setError(errorMessage(e)));
    return () => { alive = false; };
  }, [id]);

  useEffect(() => { lastId.current = messages.length ? messages[messages.length - 1].id : lastId.current; }, [messages]);

  // realtime push + polling fallback
  useEffect(() => {
    if (!conv) return undefined;
    let channel;
    let cancelled = false;
    (async () => {
      try {
        await supabase.realtime.setAuth();
        if (cancelled) return;
        channel = supabase.channel(`chat:${id}`, { config: { private: true } })
          .on('broadcast', { event: 'message' }, () => loadNewer())    // we only use the push as a "go and look" signal
          .subscribe();
      } catch (_) { /* polling below still works */ }
    })();
    const timer = setInterval(loadNewer, 8000);
    return () => { cancelled = true; clearInterval(timer); if (channel) supabase.removeChannel(channel); };
  }, [conv?.id, id, loadNewer]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (stick.current) bottom.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  const loadEarlier = async () => {
    stick.current = false;
    try {
      const d = await api(`/api/conversations/${id}?beforeId=${messages[0].id}`);
      setMessages((cur) => [...d.messages, ...cur]);
      setHasMore(d.hasMore);
    } catch (e) { setError(errorMessage(e)); }
  };

  const send = async (e) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setError(''); setNote('');
    try {
      const d = await api(`/api/conversations/${id}/messages`, { method: 'POST', body: { body } });
      stick.current = true;
      merge([d.message]);
      setText('');
      if (d.message.wasMasked) setNote(t('chat.maskedNote'));
    } catch (err) {
      setError(errorMessage(err));
      loadNewer();                                    // e.g. blocked meanwhile: refresh the state of the chat
    }
    setSending(false);
  };

  // Enter sends, Shift+Enter makes a new line. While a Bangla keyboard is composing a letter, Enter must not send.
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) send(e); };

  const toggleBlock = async () => {
    setMenu(false);
    const block = !conv.blockedByMe;
    if (block && !window.confirm(t('chat.blockConfirm'))) return;
    try {
      const d = await api(`/api/conversations/${id}/block`, { method: 'POST', body: { blocked: block } });
      setConv(d.conversation);
    } catch (err) { setError(errorMessage(err)); }
  };

  if (error && !conv) return <div><p className="error">{error}</p><Link className="back" to="/messages">← {t('chat.inboxTitle')}</Link></div>;
  if (!conv) return <p className="loading">{t('common.loading')}</p>;

  return (
    <div className="chat">
      <Link className="back" to="/messages">← {t('chat.inboxTitle')}</Link>
      <div className="chat-head">
        <span className="avatar" aria-hidden="true">{conv.otherName.trim().charAt(0).toUpperCase()}</span>
        <div className="chat-title">
          <strong>{conv.otherName}</strong>
          <Link to={`/listings/${conv.listingId}`}>{pick(conv, 'cropName')}{conv.variety ? ` · ${conv.variety}` : ''}</Link>
        </div>
        <div className="chat-menu">
          <button className="btn btn-small" aria-haspopup="true" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
          {menu && (
            <div className="menu-pop" role="menu">
              <button role="menuitem" onClick={() => { setMenu(false); setReport({ kind: 'user', conversationId: conv.id }); }}>{t('chat.reportPerson')}</button>
              <button role="menuitem" onClick={toggleBlock}>{conv.blockedByMe ? t('chat.unblock') : t('chat.block')}</button>
            </div>
          )}
        </div>
      </div>
      {conv.listingStatus !== 'live' && <p className="notice">{t('chat.listingEnded')}</p>}
      {report && <ReportForm target={report} onClose={() => setReport(null)} />}

      <div className="chat-log" role="log" aria-live="polite" onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}>
        {hasMore && <button className="btn btn-small chat-earlier" onClick={loadEarlier}>{t('chat.loadEarlier')}</button>}
        {messages.length === 0 && <p className="muted center">{t('chat.noMessages')}</p>}
        {messages.map((m) => (
          <div key={m.id} className={`bubble-row ${m.mine ? 'mine' : 'theirs'}`}>
            <div className="bubble">
              <p>{m.body}</p>
              <span className="bubble-meta">
                {formatDate(m.createdAt)}
                {!m.mine && <button className="link-btn small" onClick={() => setReport({ kind: 'message', messageId: m.id })}>{t('chat.report')}</button>}
              </span>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {error && <p className="error">{error}</p>}
      {note && <p className="notice">{note}</p>}
      {conv.canSend ? (
        <form className="chat-compose" onSubmit={send}>
          <label className="sr-only" htmlFor="chat-text">{t('chat.placeholder')}</label>
          <textarea id="chat-text" rows={2} maxLength={2000} value={text} placeholder={t('chat.placeholder')}
            onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
          <button className="btn btn-primary" disabled={sending || !text.trim()}>{sending ? t('chat.sending') : t('chat.send')}</button>
        </form>
      ) : (
        <div className="notice">
          {conv.blockedByMe ? t('chat.blockedByMe') : t('chat.cannotSend')}
          {conv.blockedByMe && <> <button className="link-btn" onClick={toggleBlock}>{t('chat.unblock')}</button></>}
        </div>
      )}
      <p className="muted small">🔒 {t('chat.privacyNote')}</p>
    </div>
  );
}
