// Number of unread chat messages for the menu badge. Refreshes every 30 s, when the page changes and when a chat page
// tells us it marked something as read (window event "hx-unread").
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';

export default function useUnread(enabled) {
  const [n, setN] = useState(0);
  const { pathname } = useLocation();
  useEffect(() => {
    if (!enabled) { setN(0); return undefined; }
    let alive = true;
    const load = () => api('/api/conversations/unread').then((d) => alive && setN(d.unread)).catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener('hx-unread', load);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('hx-unread', load); };
  }, [enabled, pathname]);
  return n;
}
