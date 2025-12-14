import { useState, useRef, useEffect, useCallback } from 'react';
import { ConnectionState } from '../types';
import { downsampleBuffer } from '../utils/audio-utils';
// @ts-ignore
import { pipeline, env } from '@xenova/transformers';

// Configure transformers.js to not look for local files
env.allowLocalModels = false;
env.useBrowserCache = true;

const WHISPER_MODEL = 'Xenova/whisper-tiny.en'; // Tiny model for speed

interface LocalTranslatorConfig {
  ollamaUrl: string;
  modelName: string;
}

export const useLocalTranslator = (config: LocalTranslatorConfig) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [ollamaConnectionStatus, setOllamaConnectionStatus] = useState<'connected' | 'disconnected' | 'unknown'>('unknown');
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  
  const [sourceStream, setSourceStream] = useState<MediaStream | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isRefreshingModels, setIsRefreshingModels] = useState<boolean>(false);

  // Audio Processing
  const inputContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioBufferRef = useRef<Float32Array>(new Float32Array(0));
  
  // Models
  const transcriberRef = useRef<any>(null);
  const isProcessingRef = useRef<boolean>(false);

  // Initialize Whisper Model
  const initModel = async () => {
    try {
      setStatusMessage('Downloading Whisper model (approx 40MB)... this happens once.');
      setConnectionState(ConnectionState.CONNECTING);
      setDownloadProgress(0);

      // Create a custom progress callback
      const progressCallback = (progress: any) => {
        if (progress.status === 'progress') {
          const progressValue = Math.round(progress.progress * 100);
          setDownloadProgress(progressValue);
          setStatusMessage(`Downloading Whisper model... ${progressValue}%`);
        }
      };

      // @ts-ignore - transformers.js supports progress callback
      const transcriber = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
        progress_callback: progressCallback
      });
      transcriberRef.current = transcriber;

      setStatusMessage('Model loaded. Ready.');
      setConnectionState(ConnectionState.CONNECTED);
      setDownloadProgress(100);
    } catch (err: any) {
      console.error(err);
      setError("Failed to load Whisper model. Check internet connection.");
      setConnectionState(ConnectionState.ERROR);
      setDownloadProgress(0);
    }
  };

  const cleanup = useCallback(() => {
    if (sourceStream) {
      sourceStream.getTracks().forEach(track => track.stop());
      setSourceStream(null);
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (inputContextRef.current && inputContextRef.current.state !== 'closed') {
      inputContextRef.current.close();
      inputContextRef.current = null;
    }

    // Cancel TTS
    window.speechSynthesis.cancel();

    setConnectionState(ConnectionState.DISCONNECTED);
    setStatusMessage('');
  }, [sourceStream]);

  // Fetch Models from Ollama
  const refreshModels = useCallback(async () => {
    try {
      setIsRefreshingModels(true);
      setError(null);

      // Timeout signal
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${config.ollamaUrl}/api/tags`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama ${response.status}: ${errorText || response.statusText}`);
      }

      const data = await response.json();

      console.log('Ollama API Response:', data);

      let models: any[] = [];

      // Try standard format
      if (data.models && Array.isArray(data.models)) {
        models = data.models;
      }
      // Try alternative format
      else if (data.Model && Array.isArray(data.Model)) {
        models = data.Model;
      }
      // Try array directly
      else if (Array.isArray(data)) {
        models = data;
      }
      // Try parsing string
      else if (typeof data.models === 'string') {
        try {
          models = JSON.parse(data.models);
        } catch (e) {
          console.warn('Failed to parse models string:', e);
        }
      }

      // Deep search for objects with 'name'
      if (models.length === 0) {
        const allObjects: any[] = [];
        const findObjects = (obj: any) => {
          if (typeof obj === 'object' && obj !== null) {
            if (obj.name && !allObjects.find((o: any) => o.name === obj.name)) {
              allObjects.push(obj);
            }
            Object.values(obj).forEach(findObjects);
          }
        };
        findObjects(data);
        models = allObjects;
      }

      // Extract names
      const names = models
        .map((m: any) => {
          return m.name || m.id || m.model || m.tag || '';
        })
        .filter((name: string) => name && typeof name === 'string' && name.length > 0);

      const uniqueNames = [...new Set(names)];

      setAvailableModels(uniqueNames);
      setOllamaConnectionStatus('connected');
      return uniqueNames;
    } catch (err: any) {
      console.error("Failed to fetch models", err);
      const errorMessage = err?.message || `Cannot connect to Ollama at ${config.ollamaUrl}`;
      setError(errorMessage);
      setAvailableModels([]);
      setOllamaConnectionStatus('disconnected');
      return [];
    } finally {
      setIsRefreshingModels(false);
    }
  }, [config.ollamaUrl]);

  const processAudioBuffer = async () => {
    if (!transcriberRef.current || isProcessingRef.current || audioBufferRef.current.length === 0) {
      return;
    }

    const duration = audioBufferRef.current.length / 16000;
    if (duration < 2.0) {
      return;
    }

    isProcessingRef.current = true;
    const inputData = audioBufferRef.current; // Copy ref
    audioBufferRef.current = new Float32Array(0); // Reset buffer

    try {
      const result = await transcriberRef.current(inputData, {
        language: 'english',
        task: 'transcribe'
      });

      const text = result.text.trim();

      if (text && text.length > 2) {
        console.log("Heard:", text);
        await translateAndSpeak(text);
      }
    } catch (e) {
      console.error("Transcription error", e);
    } finally {
      isProcessingRef.current = false;
    }
  };

  const translateAndSpeak = async (text: string) => {
    try {
      const response = await fetch(`${config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.modelName,
          prompt: `Translate the following English text to Chinese (Mandarin) immediately. Output ONLY the translated text, no explanation. \n\nEnglish: ${text}\nChinese:`,
          stream: false
        })
      });

      if (!response.ok) throw new Error("Ollama connection failed");
      
      const data = await response.json();
      const translatedText = data.response.trim();
      
      console.log("Translated:", translatedText);

      if (translatedText) {
        speak(translatedText);
      }

    } catch (err) {
      console.error("Translation failed:", err);
    }
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.1; 
    window.speechSynthesis.speak(utterance);
  };

  const startTranslation = useCallback(async () => {
    setError(null);
    setStatusMessage('Starting translation session...');

    await refreshModels();

    // Check connection
    try {
       const controller = new AbortController();
       const id = setTimeout(() => controller.abort(), 2000);
       const check = await fetch(`${config.ollamaUrl}/api/tags`, { signal: controller.signal });
       clearTimeout(id);
       if (!check.ok) throw new Error();
    } catch (e) {
       setError(`Cannot reach Ollama at ${config.ollamaUrl}. Make sure it is running with OLLAMA_ORIGINS="*"`);
       setConnectionState(ConnectionState.ERROR);
       return;
    }

    if (!transcriberRef.current) {
        setStatusMessage('Loading AI model...');
        await initModel();
    } else {
        setStatusMessage('Ready to capture audio...');
        setConnectionState(ConnectionState.CONNECTED);
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error("Browser does not support getDisplayMedia");
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
        }
      });

      if (!stream || stream.getAudioTracks().length === 0) {
          setStatusMessage('Audio capture cancelled or no audio track found');
          setConnectionState(ConnectionState.DISCONNECTED);
          return;
      }
      
      stream.getVideoTracks().forEach(track => track.stop());

      setSourceStream(stream);

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass({ sampleRate: 44100 });
      inputContextRef.current = ctx;

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const downsampled = downsampleBuffer(inputData, ctx.sampleRate, 16000);

        const newBuffer = new Float32Array(audioBufferRef.current.length + downsampled.length);
        newBuffer.set(audioBufferRef.current);
        newBuffer.set(downsampled, audioBufferRef.current.length);
        audioBufferRef.current = newBuffer;

        if (!isProcessingRef.current && audioBufferRef.current.length > 16000 * 3) {
            processAudioBuffer();
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination); 
      
      sourceNodeRef.current = source;
      processorRef.current = processor;

      const interval = setInterval(() => {
         processAudioBuffer();
      }, 1000);

      (processor as any)._interval = interval;

    } catch (err: any) {
      console.error(err);
      const errorMessage = err.message || 'Failed to start translation session';
      setError(errorMessage);
      setStatusMessage(errorMessage);
      setConnectionState(ConnectionState.ERROR);
      cleanup();
    }
  }, [cleanup, config]);

  const stopTranslation = useCallback(() => {
    if (processorRef.current && (processorRef.current as any)._interval) {
        clearInterval((processorRef.current as any)._interval);
    }
    cleanup();
  }, [cleanup]);

  useEffect(() => {
    return () => {
        stopTranslation();
    };
  }, [stopTranslation]);

  return {
    connectionState,
    error,
    statusMessage,
    startTranslation,
    stopTranslation,
    sourceStream,
    availableModels,
    setAvailableModels,
    refreshModels,
    isRefreshingModels,
    ollamaConnectionStatus,
    downloadProgress
  };
};