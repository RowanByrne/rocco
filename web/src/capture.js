// Capture Studio: the user picks Studio's window once; after that every capture grabs the current frame.
import { emit } from './state.js';

let stream = null;
let video = null;

export const capturing = () => !!stream;

export function stopCapture() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  video = null;
  emit('capture');
}

async function start() {
  stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'window' }, audio: false, preferCurrentTab: false });
  video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  // Sharing stopped from the browser's bar, or the window closed.
  stream.getVideoTracks()[0].addEventListener('ended', stopCapture);
  emit('capture');
  await new Promise(r => setTimeout(r, 250)); // let the first frame arrive
}

// A PNG of the shared window, as a File ready to attach.
export async function captureFrame() {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('This browser can’t capture windows');
  if (!stream) await start();
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  return new File([blob], 'studio.png', { type: 'image/png' });
}
