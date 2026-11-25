import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const PAGE_LIMIT = 20;

function App() {
  const [workspace, setWorkspace] = useState('');
  const [me, setMe] = useState(null);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');

  const selectedRef = useRef(null);
  const lastSeqRef = useRef(0);
  selectedRef.current = selected;

  const loadConversations = useCallback(async (targetPage = page) => {
    if (!workspace) return;
    const r = await fetch(`/api/conversations?workspace=${encodeURIComponent(workspace)}&page=${targetPage}&limit=${PAGE_LIMIT}`);
    if (r.status === 401) {
      setMe(null);
      setItems([]);
      return;
    }
    if (!r.ok) throw new Error('Unable to load inbox');
    const data = await r.json();
    const list = Array.isArray(data) ? data : data.items || [];
    setItems(list);
    setHasMore(Boolean(data.hasMore));
    setTotal(typeof data.total === 'number' ? data.total : list.length);
    if (selectedRef.current) {
      const updated = list.find((item) => item.contact === selectedRef.current.contact);
      if (updated) setSelected(updated);
    }
  }, [workspace, page]);

  const loadMessages = useCallback(async (contact) => {
    if (!workspace || !contact) return;
    const r = await fetch(`/api/conversations/${encodeURIComponent(contact)}/messages?workspace=${encodeURIComponent(workspace)}`);
    if (r.status === 401) {
      setMe(null);
      return;
    }
    if (r.ok) setMessages(await r.json());
  }, [workspace]);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((user) => {
        setMe(user);
        if (user?.workspaces?.length) {
          setWorkspace((prev) => (user.workspaces.some((w) => w.id === prev) ? prev : user.workspaces[0].id));
        } else {
          setWorkspace('');
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (me && workspace) {
      loadConversations(page).catch(console.error);
    }
  }, [me, workspace, page, loadConversations]);

  useEffect(() => {
    if (!me || !workspace) return undefined;
    lastSeqRef.current = 0;
    let disposed = false;
    let ws = null;
    let reconnectTimer = null;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${protocol}://${location.host}/ws?workspace=${encodeURIComponent(workspace)}&after=${lastSeqRef.current}`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempt = 0;
        loadConversations().catch(console.error);
        if (selectedRef.current) loadMessages(selectedRef.current.contact).catch(console.error);
      };

      ws.onmessage = (event) => {
        try {
          const evt = JSON.parse(event.data);
          if (typeof evt.seq === 'number' && evt.seq > lastSeqRef.current) {
            lastSeqRef.current = evt.seq;
          }
          loadConversations().catch(console.error);
          if (selectedRef.current && (!evt.contact || evt.contact === selectedRef.current.contact)) {
            loadMessages(selectedRef.current.contact).catch(console.error);
          }
        } catch (error) {
          console.error('Invalid WebSocket frame', error);
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        const delay = Math.min(1000 * 2 ** attempt, 5000);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [me, workspace, loadConversations, loadMessages]);

  useEffect(() => {
    if (!selected || !workspace) {
      setMessages([]);
      return;
    }
    loadMessages(selected.contact).catch(console.error);
  }, [selected?.contact, workspace, loadMessages]);

  const send = async () => {
    if (!draft.trim() || !selected) return;
    const text = draft.trim();
    setDraft('');
    const r = await fetch(`/api/conversations/${encodeURIComponent(selected.contact)}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace, text }),
    });
    if (!r.ok) {
      alert('Reply failed');
      return;
    }
    const data = await r.json();
    setMessages((x) => [...x, { direction: 'outbound', text, status: 'queued', clientRef: data.client_ref }]);
    loadConversations().catch(console.error);
  };

  const claim = async () => {
    if (!selected) return;
    const r = await fetch(`/api/conversations/${encodeURIComponent(selected.contact)}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace }),
    });
    if (r.ok) {
      const updated = await r.json();
      setSelected(updated);
      loadConversations().catch(console.error);
    } else {
      alert('Conversation is held by another agent');
    }
  };

  const toggleState = async () => {
    if (!selected) return;
    const nextState = selected.state === 'closed' ? 'open' : 'closed';
    const r = await fetch(`/api/conversations/${encodeURIComponent(selected.contact)}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace, state: nextState }),
    });
    if (r.ok) {
      const updated = await r.json();
      setSelected(updated);
      loadConversations().catch(console.error);
    } else {
      alert('Unable to update conversation state');
    }
  };

  if (!me) {
    return (
      <main>
        <h1>Switchboard</h1>
        <p>Sign in to open the shared inbox.</p>
        <a className="button" href="/auth/login">Sign in</a>
      </main>
    );
  }

  return (
    <main>
      <header>
        <div>
          <h1>Switchboard</h1>
          <small>{me.sub}</small>
        </div>
        <select
          value={workspace}
          onChange={(e) => {
            setWorkspace(e.target.value);
            setPage(1);
            setSelected(null);
            setMessages([]);
          }}
        >
          {me.workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.id}</option>
          ))}
        </select>
      </header>
      <div className="layout">
        <aside>
          {items.map((x) => (
            <button
              className={selected?.contact === x.contact ? 'active' : ''}
              key={x.contact}
              onClick={() => setSelected(x)}
            >
              <b>{x.contact}</b>
              <span>{x.state} · {x.assignee || 'unassigned'}</span>
            </button>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', gap: 8 }}>
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            <small>Page {page} ({total})</small>
            <button type="button" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </aside>
        <section className="conversation">
          {selected ? (
            <>
              <div className="conversationHead">
                <div>
                  <h2>{selected.contact}</h2>
                  <small>{selected.state} · {selected.assignee || 'unassigned'}</small>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={claim}>Claim</button>
                  <button type="button" onClick={toggleState}>{selected.state === 'closed' ? 'Reopen' : 'Close'}</button>
                </div>
              </div>
              <div className="messages">
                {messages.map((m, i) => (
                  <p key={m._id || m.clientRef || i} className={m.direction}>
                    {m.text}
                    <small>{m.status || ''}</small>
                  </p>
                ))}
              </div>
              <div className="composer">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder="Write a reply"
                />
                <button type="button" onClick={send}>Send</button>
              </div>
            </>
          ) : (
            <p>Select a conversation.</p>
          )}
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
