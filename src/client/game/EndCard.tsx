import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { context, navigateTo, showToast } from '@devvit/web/client';
import { causePair, type Daily } from '../../shared/daily';
import { sfxWin } from './audio';
import type { DeathCause, ResultResponse } from '../../shared/api';
import { joinSubreddit, shareResult, submitResult } from './net';
import { RESCUE_CARD_AT } from './Rescue';
import { DEATH_LABEL, getVersion, rescueFx, run, subscribe } from './state';

function mmss(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// '2026-11-20' -> 'Nov 20' (dayKey is a UTC date)
function shortDate(dayKey: string) {
  const d = new Date(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const DAYS = [1, 2, 3, 4, 5];

const KILLER: Record<DeathCause, string> = {
  tiger: 'Tiger',
  snake: 'Viper',
  venom: 'Venom',
  boar: 'Boar',
  gator: 'Alligator',
  thirst: 'Thirst',
  hunger: 'Hunger',
  cold: 'Cold',
  injuries: 'Injuries',
};

function toast(text: string) {
  try {
    showToast(text);
  } catch {
    // outside Reddit
  }
}

// What killed people today, as a share of all deaths (the community "heatmap" by cause).
function topKillers(res: ResultResponse) {
  const entries = Object.entries(res.stats.causes) as [DeathCause, number][];
  const total = entries.reduce((a, [, n]) => a + n, 0);
  if (!total) return [];
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c, n]) => ({ label: KILLER[c], pct: Math.round((n / total) * 100) }));
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  return url ? (
    <img className="lb-avatar" src={url} alt="" loading="lazy" />
  ) : (
    <span className="lb-avatar lb-avatar-fallback" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// splash plane silhouette: level when rescued, nose-down when lost
function EndEmblem({ rescued }: { rescued: boolean }) {
  return (
    <div className="end-emblem" aria-hidden="true">
      <svg viewBox="-40 -24 76 48">
        <g transform={rescued ? 'rotate(-8)' : 'rotate(24)'}>
          <path className="pm-body" d="M-30 0 C-22 -7 10 -8 22 -5 L29 0 L22 5 C10 7 -22 5 -30 2 Z" />
          <path className="pm-body" d="M-29 1 L-36 -13 L-29 -13 L-21 -3 Z" />
          <path className="pm-wing" d="M-8 -9 L18 -9 L16 -6 L-8 -6 Z" />
          <path className="pm-window" d="M6 -3 h9 l3 3 h-12 z" />
        </g>
      </svg>
    </div>
  );
}

function resultText(daily: Daily, rescued: boolean) {
  const lines = [
    `Crash Day · ${shortDate(daily.dayKey)} · ${causePair(daily)}`,
    rescued ? `Rescued after ${mmss(run.timeAlive)}` : `Survived ${mmss(run.timeAlive)} · reached day ${Math.min(run.day, 5)}`,
    `${plural(run.collected, 'item')} found · ${run.tigerDown ? 'drove off the tiger' : plural(run.tigerHits, 'tiger hit')}`,
  ];
  return lines.join('\n');
}

export function EndCard({ daily, onRetry }: { daily: Daily; onRetry: () => void }) {
  useSyncExternalStore(subscribe, getVersion);
  const rescued = run.phase === 'rescued';
  const over = run.phase === 'dead' || rescued;
  const [copied, setCopied] = useState(false);
  const [res, setRes] = useState<ResultResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [shared, setShared] = useState(false);
  const [joined, setJoined] = useState(false);
  const submitted = useRef(false);

  // send the finished run once; the server answers with rank, streak, flair and the leaderboard
  useEffect(() => {
    if (!over) {
      submitted.current = false;
      setRes(null);
      setShared(false);
      return;
    }
    if (submitted.current) return;
    submitted.current = true;
    void submitResult().then((r) => {
      if (r && r.type === 'result') setRes(r);
    });
  }, [over]);

  // the rescue cinematic (Rescue.tsx) plays first; the card follows when it sets rescueDone
  const cinematic = rescued && !run.rescueDone;

  useEffect(() => {
    if (rescued && !cinematic) sfxWin();
  }, [rescued, cinematic]);

  useEffect(() => {
    if (!over) setCopied(false);
  }, [over]);

  if (!over) return null;

  if (cinematic) {
    return (
      <div className="rescue-cine">
        <div className="rescue-caption">
          <b>Dawn, day 6</b>
          <span>A rescue helicopter spotted your flare.</span>
        </div>
        <button
          type="button"
          className="chip rescue-skip"
          onClick={() => {
            rescueFx.t = Math.max(rescueFx.t, RESCUE_CARD_AT);
          }}
        >
          Skip
        </button>
      </div>
    );
  }

  const copy = () => {
    const text = resultText(daily, rescued);
    const done = () => {
      setCopied(true);
      try {
        showToast('Result copied. Paste it in the comments!');
      } catch {
        // outside Reddit: the button label is the confirmation
      }
    };
    try {
      void navigator.clipboard.writeText(text).then(done, () => setCopied(false));
    } catch {
      setCopied(false);
    }
  };

  const kills = run.kills.snake + run.kills.boar + run.kills.gator;
  const dayReached = Math.min(run.day, 5);

  return (
    <div className={`endcard ${rescued ? 'won' : 'lost'}`}>
      <div className="end-inner" role="dialog" aria-modal="true" aria-labelledby="end-title">
        <div className="end-brand">
          Crash <span>Day</span>
        </div>
        <EndEmblem rescued={rescued} />
        <div className="end-kicker">
          <span>{shortDate(daily.dayKey)}</span>
          <i aria-hidden="true" />
          <span>{causePair(daily)}</span>
        </div>
        <div className="end-title" id="end-title">{rescued ? 'Rescued' : 'You didn’t make it'}</div>
        <div className="end-cause">
          {rescued ? 'A rescue helicopter spotted your flare at dawn.' : DEATH_LABEL[run.deathCause ?? 'injuries']}
        </div>

        <div className="end-hero">
          <b>{mmss(run.timeAlive)}</b>
          <span>survived</span>
        </div>

        <div className="end-days" aria-label={`Day ${dayReached} of 5`}>
          {DAYS.map((d) => (
            <i key={d} className={d < dayReached || rescued ? 'done' : d === dayReached ? 'here' : ''} />
          ))}
        </div>

        <div className="end-stats">
          <div>
            <b>Day {dayReached}</b>
            <span>reached</span>
          </div>
          <div>
            <b>{run.collected}</b>
            <span>items found</span>
          </div>
          <div>
            <b>{run.tigerDown ? 'Drove off' : run.tigerHits}</b>
            <span>{run.tigerDown ? 'the tiger' : 'tiger hits'}</span>
          </div>
        </div>

        {kills > 0 && (
          <div className="end-kills">
            {run.kills.snake > 0 && <span>{plural(run.kills.snake, 'viper')}</span>}
            {run.kills.boar > 0 && <span>{plural(run.kills.boar, 'boar')}</span>}
            {run.kills.gator > 0 && <span>{plural(run.kills.gator, 'alligator')}</span>}
          </div>
        )}

        {res && (
          <div className="end-online">
            <div className="end-rank">
              {res.rank ? (
                <>
                  <b>#{res.rank}</b>
                  <span>
                    of {res.players} today{res.percentile !== null && res.players > 1 ? ` · beat ${res.percentile}%` : ''}
                    {res.personalBest ? ' · personal best' : ''}
                  </span>
                </>
              ) : (
                <span>Sign in to join today's leaderboard</span>
              )}
            </div>
            {(res.streak.count > 0 || res.flair) && (
              <div className="end-badges">
                {res.streak.count > 0 && <span className="badge streak">{res.streak.count}-day streak</span>}
                {res.flair && <span className="badge flair">Flair: {res.flair}</span>}
              </div>
            )}
            {res.leaderboard.length > 0 && (
              <ol className="end-lb" aria-label="Today's top survivors">
                {res.leaderboard.map((e) => (
                  <li key={e.username} className={res.me?.username === e.username ? 'me' : ''}>
                    <span className="lb-rank">{e.rank}</span>
                    <Avatar url={e.snoovatar} name={e.username} />
                    <span className="lb-name">u/{e.username}</span>
                    <span className="lb-time">{e.rescued ? 'Rescued' : mmss(e.seconds)}</span>
                  </li>
                ))}
              </ol>
            )}
            {topKillers(res).length > 0 && (
              <div className="end-killers">
                <span>Today's killers</span>
                {topKillers(res).map((k) => (
                  <i key={k.label}>
                    {k.label} {k.pct}%
                  </i>
                ))}
              </div>
            )}
            <div className="end-community">
              {res.stats.survived.toLocaleString()} survived · {res.stats.crashed.toLocaleString()} crashed today
            </div>
          </div>
        )}

        <button type="button" className="end-retry" onClick={onRetry}>
          {rescued ? 'Play again' : 'Try again'}
        </button>
        <div className="end-actions">
          {res?.me ? (
            <button
              type="button"
              className={`end-share${shared ? ' copied' : ''}`}
              disabled={pending || shared}
              onClick={() => {
                setPending(true);
                void shareResult().then((r) => {
                  setPending(false);
                  if (r?.ok) setShared(true);
                  toast(r?.message ?? 'Could not post the comment.');
                });
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={shared ? 'M5 12.5l4.5 4.5L19 7.5' : 'M4 5h16v11H9l-5 4z'} />
              </svg>
              {shared ? 'Posted' : pending ? 'Posting…' : 'Post to comments'}
            </button>
          ) : (
            <button type="button" className={`end-share${copied ? ' copied' : ''}`} onClick={copy}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={copied ? 'M5 12.5l4.5 4.5L19 7.5' : 'M9 9h10v11H9zM5 15V4h10'} />
              </svg>
              {copied ? 'Copied' : 'Copy result'}
            </button>
          )}
          {res?.me && (
            <button
              type="button"
              className={`end-share end-join${joined ? ' copied' : ''}`}
              disabled={joined}
              onClick={() => {
                void joinSubreddit().then((r) => {
                  if (r?.ok) setJoined(true);
                  toast(r?.message ?? 'Could not join right now.');
                  if (r && !r.ok && r.fallback === 'open-subreddit' && context.subredditName) {
                    try {
                      navigateTo(`https://www.reddit.com/r/${context.subredditName}`);
                    } catch {
                      // outside Reddit
                    }
                  }
                });
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={joined ? 'M5 12.5l4.5 4.5L19 7.5' : 'M12 5v14M5 12h14'} />
              </svg>
              {joined ? 'Joined' : 'Join for tomorrow'}
            </button>
          )}
        </div>
        <div className="end-foot">Same crash for everyone today. New crash tomorrow.</div>
      </div>
    </div>
  );
}
