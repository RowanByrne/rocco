// Voice notes: the browser's speech recognition. Chrome sends the audio to Google and Edge to Microsoft,
// which is why it's off until the user turns it on in Settings.
import { emit } from './state.js';
import { settings } from './settings.js';

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let startedAt = 0;

export const voiceSupported = () => !!Recognition;
export const listening = () => !!rec;
export const listeningFor = () => rec ? Math.floor((Date.now() - startedAt) / 1000) : 0;

// Drop the ums and ahs, and start with a capital.
const tidy = text => text.replace(/\b(um+|uh+|erm+|er|ah+|hmm+)\b[,.]?\s*/gi, '').replace(/\s{2,}/g, ' ').trim().replace(/^./, c => c.toUpperCase());

// onText(text, final): the words so far. Calling it again stops.
export function toggleVoice(onText) {
  if (rec) { rec.stop(); return; }
  if (!Recognition) throw new Error('This browser has no speech recognition');
  if (!settings().voice) throw new Error('Turn voice notes on in Settings first');
  rec = new Recognition();
  rec.lang = settings().voiceLang;
  rec.continuous = true;
  rec.interimResults = true;
  let done = '';
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) done += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
    onText(tidy(done + interim), false);
  };
  rec.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') emit('voice-error', e.error); };
  rec.onend = () => { rec = null; onText(tidy(done), true); emit('voice'); };
  startedAt = Date.now();
  rec.start();
  emit('voice');
}
