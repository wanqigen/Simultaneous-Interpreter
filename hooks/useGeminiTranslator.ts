import { useState, useRef, useEffect, useCallback } from 'react';
import { ConnectionState } from '../types';
import { downsampleBuffer, encodeWAV, arrayBufferToBase64, base64ToUint8Array } from '../utils/audio-utils';

interface LocalTranslatorConfig {
  ollamaUrl: string;
  modelName: string;
}

export const useLocalTranslator = (config: LocalTranslatorConfig) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [ollamaConnectionStatus, setOllamaConnectionStatus] = useState<'connected' | 'disconnected' | 'unknown'>('unknown');
  const [downloadProgress, setDownloadProgress] = useState<number>(100); // No longer needed, set to 100
  
  const [sourceStream, setSourceStream] = useState<MediaStream | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isRefreshingModels, setIsRefreshingModels] = useState<boolean>(false);

  // Audio Processing
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioBufferRef = useRef<Float32Array>(new Float32Array(0));
  
  // Processing State
  const isProcessingRef = useRef<boolean>(false);
  
  // Audio Playback Queue
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef<boolean>(false);

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
    if (outputContextRef.current && outputContextRef.current.state !== 'closed') {
      outputContextRef.current.close();
      outputContextRef.current = null;
    }

    setConnectionState(ConnectionState.DISCONNECTED);
    setStatusMessage('');
  }, [sourceStream]);

  // Fetch Models from Ollama
  const refreshModels = useCallback(async () => {
    try {
      setIsRefreshingModels(true);
      setError(null);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${config.ollamaUrl}/api/tags`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama ${response.status}`);
      }

      const data = await response.json();
      let models: any[] = [];

      if (data.models && Array.isArray(data.models)) models = data.models;
      else if (data.Model && Array.isArray(data.Model)) models = data.Model;
      else if (Array.isArray(data)) models = data;

      const names = models
        .map((m: any) => m.name || m.id || m.model || m.tag || '')
        .filter((name: string) => name && typeof name === 'string' && name.length > 0);

      const uniqueNames = [...new Set(names)];
      setAvailableModels(uniqueNames);
      setOllamaConnectionStatus('connected');
      return uniqueNames;
    } catch (err: any) {
      console.error("Failed to fetch models", err);
      setAvailableModels([]);
      setOllamaConnectionStatus('disconnected');
      return [];
    } finally {
      setIsRefreshingModels(false);
    }
  }, [config.ollamaUrl]);

  // Queue and Play Audio Response
  const queueAudioResponse = async (base64Audio: string) => {
    try {
      // Decode Base64 to ArrayBuffer
      const uint8Array = base64ToUint8Array(base64Audio);
      audioQueueRef.current.push(uint8Array.buffer);
      playNextInQueue();
    } catch (e) {
      console.error("Error decoding audio response:", e);
    }
  };

  const playNextInQueue = async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;

    if (!outputContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        outputContextRef.current = new AudioContextClass();
    }
    
    // Ensure context is running
    if (outputContextRef.current.state === 'suspended') {
        await outputContextRef.current.resume();
    }

    isPlayingRef.current = true;
    const audioData = audioQueueRef.current.shift();

    if (!audioData) {
        isPlayingRef.current = false;
        return;
    }

    try {
        // Decode the MP3/WAV/etc returned by model
        const audioBuffer = await outputContextRef.current.decodeAudioData(audioData);
        const source = outputContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(outputContextRef.current.destination);
        
        source.onended = () => {
            isPlayingRef.current = false;
            playNextInQueue();
        };
        
        source.start();
    } catch (err) {
        console.error("Error playing audio buffer", err);
        isPlayingRef.current = false;
        playNextInQueue();
    }
  };

  const processAudioBuffer = async () => {
    if (isProcessingRef.current || audioBufferRef.current.length === 0) {
      return;
    }

    // Process every 3 seconds of audio roughly (3 * 16000 samples)
    // Adjust this threshold based on model latency preference
    if (audioBufferRef.current.length < 16000 * 2.5) {
      return;
    }

    isProcessingRef.current = true;
    const inputData = audioBufferRef.current; // Copy ref
    audioBufferRef.current = new Float32Array(0); // Reset buffer

    try {
      console.log("Encoding audio...");
      // 1. Encode to WAV
      const wavBuffer = encodeWAV(inputData, 16000);
      const base64Audio = arrayBufferToBase64(wavBuffer);
      
      console.log("Sending audio to Ollama...");
      
      // 2. Send to Ollama
      // Schema assumes standard Ollama "generate" with binary in 'images' 
      // OR a custom field 'audio' if supported by user's specific model.
      const response = await fetch(`${config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.modelName,
          prompt: "Translate the following audio from English to Chinese. Output audio data.",
          stream: false,
          // Sending audio in 'images' field as it's the standard binary slot for multimodal in current Ollama versions.
          // Some custom audio forks use 'audio' field. We send in 'images' primarily.
          images: [base64Audio] 
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API Error: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // 3. Handle Response
      // We assume the model returns the base64 audio string directly in 'response'
      const responseContent = data.response.trim();
      
      if (responseContent) {
        console.log("Received response length:", responseContent.length);
        await queueAudioResponse(responseContent);
      } else {
        console.warn("Received empty response from model");
      }

    } catch (err) {
      console.error("Audio processing failed:", err);
    } finally {
      isProcessingRef.current = false;
    }
  };

  const startTranslation = useCallback(async () => {
    let stream: MediaStream | null = null;

    try {
      // 1. Get Permission First
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error("Browser does not support screen sharing.");
      }

      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              sampleRate: 44100
          }
        });
      } catch (mediaErr: any) {
        if (mediaErr.name === 'NotAllowedError' || mediaErr.message.includes('Permission denied')) {
            throw new Error("Screen sharing cancelled by user.");
        }
        throw mediaErr;
      }

      setConnectionState(ConnectionState.CONNECTING);
      setError(null);
      setSourceStream(stream);

      // 2. Validate Audio
      if (stream.getAudioTracks().length === 0) {
          stream.getTracks().forEach(track => track.stop());
          throw new Error("No audio found! Check 'Also share tab audio' in Chrome dialog.");
      }
      
      stream.getVideoTracks().forEach(track => track.stop());
      
      setStatusMessage('Connecting to Ollama...');

      // 3. Connect to Backend
      try {
         const controller = new AbortController();
         const id = setTimeout(() => controller.abort(), 2000);
         const check = await fetch(`${config.ollamaUrl}/api/tags`, { signal: controller.signal });
         clearTimeout(id);
         if (!check.ok) throw new Error();
      } catch (e) {
         throw new Error(`Cannot reach Ollama at ${config.ollamaUrl}`);
      }
      
      setStatusMessage('Streaming Audio to Model...');

      // 4. Setup Audio Input Processing
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
        // Downsample to 16k for bandwidth/model compatibility
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

      setConnectionState(ConnectionState.CONNECTED);

    } catch (err: any) {
      console.error(err);
      if (stream) {
          stream.getTracks().forEach(t => t.stop());
      }
      setSourceStream(null);
      setError(err.message || 'Failed to start session');
      setStatusMessage('');
      setConnectionState(ConnectionState.ERROR);
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