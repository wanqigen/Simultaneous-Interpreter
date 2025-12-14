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
  
  const [sourceStream, setSourceStream] = useState<MediaStream | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  
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
      
      const transcriber = await pipeline('automatic-speech-recognition', WHISPER_MODEL);
      transcriberRef.current = transcriber;
      
      setStatusMessage('Model loaded. Ready.');
      setConnectionState(ConnectionState.CONNECTED);
    } catch (err: any) {
      console.error(err);
      setError("Failed to load Whisper model. Check internet connection.");
      setConnectionState(ConnectionState.ERROR);
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
    if (inputContextRef.current) {
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
      setError(null);
      const response = await fetch(`${config.ollamaUrl}/api/tags`);
      if (!response.ok) throw new Error('Failed to connect to Ollama');
      
      const data = await response.json();
      // data.models is array of objects { name: "llama3:latest", ... }
      const names = data.models?.map((m: any) => m.name) || [];
      setAvailableModels(names);
      return names;
    } catch (err: any) {
      console.error("Failed to fetch models", err);
      // Don't set global error here, just log it, otherwise it blocks the UI
      setAvailableModels([]);
    }
  }, [config.ollamaUrl]);

  const processAudioBuffer = async () => {
    if (!transcriberRef.current || isProcessingRef.current || audioBufferRef.current.length === 0) return;
    
    // Only process if we have enough audio (e.g., > 2 seconds) or it's been a while
    const duration = audioBufferRef.current.length / 16000;
    if (duration < 2.0) return;

    isProcessingRef.current = true;
    const inputData = audioBufferRef.current; // Copy ref
    audioBufferRef.current = new Float32Array(0); // Reset buffer

    try {
      // 1. Transcribe (ASR)
      const result = await transcriberRef.current(inputData, {
        language: 'english',
        task: 'transcribe'
      });
      
      const text = result.text.trim();
      if (text && text.length > 2) {
        console.log("Heard:", text);
        
        // 2. Translate (Ollama)
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
    utterance.rate = 1.1; // Slightly faster for simultaneous feel
    window.speechSynthesis.speak(utterance);
  };

  const startTranslation = useCallback(async () => {
    setError(null);
    
    // Check for Ollama connection first
    try {
       const check = await fetch(`${config.ollamaUrl}/api/tags`);
       if (!check.ok) throw new Error();
    } catch (e) {
       setError(`Cannot reach Ollama at ${config.ollamaUrl}. Make sure it is running with OLLAMA_ORIGINS="*"`);
       setConnectionState(ConnectionState.ERROR);
       return;
    }

    if (!transcriberRef.current) {
        await initModel();
    } else {
        setConnectionState(ConnectionState.CONNECTED);
    }

    try {
      // Capture System Audio
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

      // User cancelled
      if (!stream) {
          setConnectionState(ConnectionState.DISCONNECTED);
          return;
      }
      
      // Stop video track
      stream.getVideoTracks().forEach(track => track.stop());

      if (stream.getAudioTracks().length === 0) {
        throw new Error("No audio track. Please check 'Share tab audio' in Chrome.");
      }

      setSourceStream(stream);

      // Setup Audio Context
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass({ sampleRate: 44100 }); // Default
      inputContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      // Use ScriptProcessor for raw access
      const processor = ctx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Downsample to 16kHz for Whisper
        const downsampled = downsampleBuffer(inputData, ctx.sampleRate, 16000);
        
        // Append to buffer
        const newBuffer = new Float32Array(audioBufferRef.current.length + downsampled.length);
        newBuffer.set(audioBufferRef.current);
        newBuffer.set(downsampled, audioBufferRef.current.length);
        audioBufferRef.current = newBuffer;

        // Trigger process if enough buffer
        if (!isProcessingRef.current && audioBufferRef.current.length > 16000 * 3) {
            processAudioBuffer();
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination); 
      
      sourceNodeRef.current = source;
      processorRef.current = processor;

      // Processing Loop interval (catch-all)
      const interval = setInterval(() => {
         processAudioBuffer();
      }, 1000);

      // Clean up interval on stop
      (processor as any)._interval = interval;

    } catch (err: any) {
      console.error(err);
      setError(err.message);
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
    refreshModels
  };
};