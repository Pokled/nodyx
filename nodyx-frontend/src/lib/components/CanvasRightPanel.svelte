<script lang="ts">
	import type { CanvasPeer, CanvasChatMsg, CanvasTool } from '$lib/canvas'
	import { tick } from 'svelte'

	let {
		peers    = [],
		messages = [],
		userId,
		username,
		boardName = 'Sans titre',
		open      = $bindable(true),
		onSend    = (_: string) => {},
	}: {
		peers:     CanvasPeer[]
		messages:  CanvasChatMsg[]
		userId:    string
		username:  string
		boardName: string
		open:      boolean
		onSend:    (text: string) => void
	} = $props()

	let draft   = $state('')
	let listEl  = $state<HTMLDivElement | null>(null)

	// Scroll to bottom when new message arrives
	$effect(() => {
		if (messages.length && listEl) {
			tick().then(() => {
				if (listEl) listEl.scrollTop = listEl.scrollHeight
			})
		}
	})

	function sendMsg() {
		const text = draft.trim()
		if (!text) return
		onSend(text)
		draft = ''
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg() }
	}

	function toolIcon(t?: CanvasTool): string {
		const m: Record<string, string> = {
			select: '↖', pen: '✏', text: 'T', sticky: '📌',
			rect: '□', circle: '○', arrow: '→', image: '🖼',
			frame: '⊡', eraser: '◻',
		}
		return t ? (m[t] ?? '·') : '·'
	}

	function initials(name: string) {
		return name.slice(0,2).toUpperCase()
	}

	function formatTime(ts: number) {
		return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
	}

	// Color from userId hash (deterministic)
	function userColor(uid: string): string {
		const colors = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#0891b2','#9333ea','#c2410c']
		let h = 0
		for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0
		return colors[h % colors.length]
	}
</script>

<div class="panel" class:collapsed={!open}>

	<!-- Toggle button -->
	<button class="toggle-btn" onclick={() => open = !open} title={open ? 'Réduire' : 'Ouvrir le panneau'}>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
		     style="width:14px;height:14px;transition:transform .2s;{open ? 'transform:rotate(0)' : 'transform:rotate(180deg)'}">
			<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
		</svg>
	</button>

	{#if open}
	<!-- Board title -->
	<div class="board-title">
		<div class="board-dot"></div>
		<span>{boardName}</span>
	</div>

	<!-- ── Participants ─────────────────────────────── -->
	<div class="section-header">
		<span>Participants</span>
		<span class="badge">{peers.length}</span>
	</div>

	<div class="peers-list">
		{#each peers as peer (peer.userId)}
			<div class="peer" class:me={peer.userId === userId}>
				<!-- Avatar -->
				<div class="avatar" style="background:{userColor(peer.userId)}">
					{#if peer.avatar}
						<img src={peer.avatar} alt={peer.username} class="avatar-img" />
					{:else}
						{initials(peer.username)}
					{/if}
					<div class="online-dot" class:active={peer.active}></div>
				</div>

				<!-- Info -->
				<div class="peer-info">
					<span class="peer-name">{peer.username}{peer.userId === userId ? ' (vous)' : ''}</span>
					<span class="peer-tool">{toolIcon(peer.tool)} {peer.tool ?? 'inactif'}</span>
				</div>

				<!-- Tool color strip -->
				{#if peer.color}
					<div class="peer-color" style="background:{peer.color}"></div>
				{/if}
			</div>
		{:else}
			<div class="empty-peers">Vous êtes seul·e pour l'instant</div>
		{/each}
	</div>

	<!-- ── Chat ──────────────────────────────────────── -->
	<div class="section-header" style="margin-top:4px">
		<span>Chat du board</span>
		{#if messages.length > 0}
			<span class="badge">{messages.length}</span>
		{/if}
	</div>

	<div class="chat-messages" bind:this={listEl}>
		{#each messages as msg (msg.id)}
			<div class="msg" class:mine={msg.userId === userId}>
				{#if msg.userId !== userId}
					<div class="msg-avatar" style="background:{userColor(msg.userId)}" title={msg.username}>
						{initials(msg.username)}
					</div>
				{/if}
				<div class="msg-body">
					{#if msg.userId !== userId}
						<span class="msg-author">{msg.username}</span>
					{/if}
					<div class="msg-bubble" class:mine={msg.userId === userId}>
						{msg.text}
					</div>
					<span class="msg-time">{formatTime(msg.ts)}</span>
				</div>
			</div>
		{:else}
			<div class="empty-chat">Aucun message — commencez la discussion !</div>
		{/each}
	</div>

	<!-- Chat input -->
	<div class="chat-input-row">
		<textarea
			class="chat-input"
			bind:value={draft}
			onkeydown={onKeydown}
			placeholder="Message…"
			rows="1"
		></textarea>
		<button class="send-btn" onclick={sendMsg} disabled={!draft.trim()} title="Envoyer (Entrée)">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/>
			</svg>
		</button>
	</div>
	{/if}

</div>

<style>
	.panel {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 256px;
		height: 100%;
		background: rgba(8, 8, 16, 0.95);
		backdrop-filter: blur(24px);
		-webkit-backdrop-filter: blur(24px);
		border-left: 1px solid rgba(255,255,255,0.06);
		transition: width 0.2s ease;
		flex-shrink: 0;
		overflow: hidden;
	}
	.panel.collapsed {
		width: 32px;
	}

	.toggle-btn {
		position: absolute;
		top: 50%;
		left: -14px;
		transform: translateY(-50%);
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 1px solid rgba(255,255,255,0.08);
		background: rgba(10,10,20,0.95);
		color: #6b7280;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
		z-index: 10;
	}
	.toggle-btn:hover { color: #d1d5db; border-color: rgba(255,255,255,0.2); }

	.board-title {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 14px 14px 8px;
		font-size: 12px;
		font-weight: 700;
		color: #e2e8f0;
		letter-spacing: -0.01em;
		border-bottom: 1px solid rgba(255,255,255,0.05);
		flex-shrink: 0;
	}

	.board-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #a855f7;
		animation: pulse-dot 2s ease-in-out infinite;
		flex-shrink: 0;
	}

	@keyframes pulse-dot {
		0%, 100% { opacity: 1; transform: scale(1); }
		50%       { opacity: 0.6; transform: scale(0.85); }
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px 5px;
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #4b5563;
		flex-shrink: 0;
	}

	.badge {
		font-size: 9px;
		font-weight: 700;
		background: rgba(124,58,237,0.25);
		color: #a78bfa;
		padding: 1px 5px;
		border-radius: 20px;
		letter-spacing: 0;
	}

	.peers-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 2px 8px 6px;
		flex-shrink: 0;
		max-height: 180px;
		overflow-y: auto;
	}

	.peer {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 6px;
		border-radius: 8px;
		transition: background 0.1s;
	}
	.peer:hover { background: rgba(255,255,255,0.03); }
	.peer.me { background: rgba(124,58,237,0.06); }

	.avatar {
		position: relative;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		font-weight: 700;
		color: white;
		flex-shrink: 0;
	}

	.avatar-img {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		object-fit: cover;
		display: block;
	}

	.online-dot {
		position: absolute;
		bottom: 0;
		right: 0;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #374151;
		border: 1.5px solid rgba(8,8,16,0.95);
	}
	.online-dot.active { background: #10b981; }

	.peer-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.peer-name {
		font-size: 11px;
		font-weight: 600;
		color: #d1d5db;
		truncate: true;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.peer-tool {
		font-size: 10px;
		color: #6b7280;
	}

	.peer-color {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.empty-peers {
		padding: 8px 6px;
		font-size: 11px;
		color: #374151;
		font-style: italic;
	}

	/* ── Chat ── */
	.chat-messages {
		flex: 1;
		overflow-y: auto;
		padding: 6px 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-height: 0;
		scrollbar-width: thin;
		scrollbar-color: rgba(255,255,255,0.06) transparent;
	}

	.empty-chat {
		text-align: center;
		font-size: 11px;
		color: #374151;
		font-style: italic;
		padding: 20px 10px;
	}

	.msg {
		display: flex;
		align-items: flex-end;
		gap: 6px;
	}
	.msg.mine { flex-direction: row-reverse; }

	.msg-avatar {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 8px;
		font-weight: 700;
		color: white;
		flex-shrink: 0;
	}

	.msg-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-width: 75%;
	}
	.msg.mine .msg-body { align-items: flex-end; }

	.msg-author {
		font-size: 9px;
		font-weight: 600;
		color: #6b7280;
		padding: 0 4px;
	}

	.msg-bubble {
		padding: 6px 10px;
		border-radius: 12px 12px 12px 4px;
		background: rgba(255,255,255,0.06);
		color: #e2e8f0;
		font-size: 12px;
		line-height: 1.45;
		word-break: break-word;
		border: 1px solid rgba(255,255,255,0.05);
	}
	.msg-bubble.mine {
		background: linear-gradient(135deg, rgba(109,40,217,0.5), rgba(124,58,237,0.4));
		border-color: rgba(124,58,237,0.3);
		border-radius: 12px 12px 4px 12px;
		color: #ede9fe;
	}

	.msg-time {
		font-size: 9px;
		color: #374151;
		padding: 0 4px;
	}

	/* Chat input */
	.chat-input-row {
		display: flex;
		align-items: flex-end;
		gap: 6px;
		padding: 8px;
		border-top: 1px solid rgba(255,255,255,0.05);
		flex-shrink: 0;
	}

	.chat-input {
		flex: 1;
		min-height: 32px;
		max-height: 80px;
		padding: 6px 10px;
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.07);
		border-radius: 10px;
		color: #e2e8f0;
		font-size: 12px;
		resize: none;
		outline: none;
		font-family: inherit;
		line-height: 1.4;
		transition: border-color 0.15s;
	}
	.chat-input:focus { border-color: rgba(124,58,237,0.4); }
	.chat-input::placeholder { color: #374151; }

	.send-btn {
		width: 32px;
		height: 32px;
		border: none;
		border-radius: 10px;
		background: linear-gradient(135deg, #6d28d9, #7c3aed);
		color: white;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: all 0.15s;
		box-shadow: 0 2px 8px rgba(124,58,237,0.3);
	}
	.send-btn:hover:not(:disabled) { transform: scale(1.05); box-shadow: 0 4px 12px rgba(124,58,237,0.4); }
	.send-btn:disabled { opacity: 0.3; cursor: not-allowed; box-shadow: none; }
	.send-btn svg { width: 15px; height: 15px; }
</style>
