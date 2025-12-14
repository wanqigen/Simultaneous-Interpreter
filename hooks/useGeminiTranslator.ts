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

      const response = await fetch(`${config.ollamaUrl}/api/tags`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        // 添加超时处理
        signal: AbortSignal.timeout(5000) // 5秒超时
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama ${response.status}: ${errorText || response.statusText}`);
      }

      const data = await response.json();

      // 调试信息：打印 API 返回的数据
      console.log('Ollama API Response:', data);
      console.log('Models found:', data.models);

      // 尝试多种可能的响应格式
      let models: any[] = [];

      // 标准格式：data.models
      if (data.models && Array.isArray(data.models)) {
        models = data.models;
      }
      // 备选格式：data.Model
      else if (data.Model && Array.isArray(data.Model)) {
        models = data.Model;
      }
      // 备选格式：直接是数组
      else if (Array.isArray(data)) {
        models = data;
      }
      // 尝试解析 models 字符串
      else if (typeof data.models === 'string') {
        try {
          models = JSON.parse(data.models);
        } catch (e) {
          console.warn('Failed to parse models string:', e);
        }
      }

      // 如果还是没有找到，尝试从整个响应中提取
      if (models.length === 0) {
        console.warn('No models found in standard formats, trying to extract from response...');
        // 尝试找到所有包含 name 属性的对象
        const allObjects = [];
        function findObjects(obj: any) {
          if (typeof obj === 'object' && obj !== null) {
            if (obj.name && !allObjects.find((o: any) => o.name === obj.name)) {
              allObjects.push(obj);
            }
            Object.values(obj).forEach(findObjects);
          }
        }
        findObjects(data);
        models = allObjects;
      }

      console.log('Final models array:', models);
      console.log('Models count:', models.length);

      // 提取模型名称
      const names = models
        .map((m: any) => {
          // 尝试多种可能的名称字段
          return m.name || m.id || m.model || m.tag || JSON.stringify(m);
        })
        .filter((name: string) => name && typeof name === 'string' && name.length > 0);

      // 去重
      const uniqueNames = [...new Set(names)];

      // 调试信息：打印提取的模型名称
      console.log('Extracted model names:', uniqueNames);
      console.log('Number of unique models:', uniqueNames.length);

      setAvailableModels(uniqueNames);
      setOllamaConnectionStatus('connected');
      return uniqueNames;
    } catch (err: any) {
      console.error("Failed to fetch models", err);
      const errorMessage = err?.message || `无法连接到 Ollama: ${config.ollamaUrl}`;
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
      console.log('Skipping processAudioBuffer - no transcriber, already processing, or empty buffer');
      return;
    }

    // Only process if we have enough audio (e.g., > 2 seconds) or it's been a while
    const duration = audioBufferRef.current.length / 16000;
    console.log('Processing audio buffer, duration:', duration, 'seconds');
    if (duration < 2.0) {
      console.log('Not enough audio to process');
      return;
    }

    isProcessingRef.current = true;
    const inputData = audioBufferRef.current; // Copy ref
    audioBufferRef.current = new Float32Array(0); // Reset buffer

    try {
      console.log('Starting transcription...');
      // 1. Transcribe (ASR)
      const result = await transcriberRef.current(inputData, {
        language: 'english',
        task: 'transcribe'
      });

      const text = result.text.trim();
      console.log('Transcription result:', text);

      if (text && text.length > 2) {
        console.log("Heard:", text);

        // 2. Translate (Ollama)
        await translateAndSpeak(text);
      } else {
        console.log('Transcription too short or empty');
      }
    } catch (e) {
      console.error("Transcription error", e);
    } finally {
      isProcessingRef.current = false;
      console.log('Processing complete');
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
        console.log('Speaking translation...');
        speak(translatedText);
      } else {
        console.log('No translation text received');
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
    setStatusMessage('Starting translation session...');

    // Refresh models before starting translation
    await refreshModels();

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
        setStatusMessage('Loading AI model...');
        await initModel();
    } else {
        setStatusMessage('Ready to capture audio...');
        setConnectionState(ConnectionState.CONNECTED);
    }

    try {
      // Capture System Audio
      setStatusMessage('Requesting permission to capture screen audio...');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error("Browser does not support getDisplayMedia");
      }

      console.log('Requesting display media...');
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
        }
      });

      console.log('Display media stream obtained:', stream);
      console.log('Audio tracks:', stream.getAudioTracks());
      console.log('Video tracks:', stream.getVideoTracks());

      // User cancels the selection - this throws an error
      if (!stream || stream.getAudioTracks().length === 0) {
          setStatusMessage('Audio capture cancelled');
          setConnectionState(ConnectionState.DISCONNECTED);
          return;
      }
      
      // Stop video track
      stream.getVideoTracks().forEach(track => track.stop());

      if (stream.getAudioTracks().length === 0) {
        throw new Error("No audio track. Please check 'Share tab audio' in Chrome.");
      }

      setStatusMessage('Audio capture started - speak now!');
      setSourceStream(stream);

      // Setup Audio Context
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass({ sampleRate: 44100 }); // Default
      inputContextRef.current = ctx;

      // Resume audio context if suspended (required in some browsers)
      if (ctx.state === 'suspended') {
        await ctx.resume();
        console.log('AudioContext resumed');
      }

      const source = ctx.createMediaStreamSource(stream);
      // Use ScriptProcessor for raw access (deprecated but simple for demo)
      // AudioWorkletNode would be better but requires more complex setup
      const processor = ctx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        console.log('Audio data received, length:', inputData.length);

        // Downsample to 16kHz for Whisper
        const downsampled = downsampleBuffer(inputData, ctx.sampleRate, 16000);

        // Append to buffer
        const newBuffer = new Float32Array(audioBufferRef.current.length + downsampled.length);
        newBuffer.set(audioBufferRef.current);
        newBuffer.set(downsampled, audioBufferRef.current.length);
        audioBufferRef.current = newBuffer;

        console.log('Buffer length:', audioBufferRef.current.length);

        // Trigger process if enough buffer
        if (!isProcessingRef.current && audioBufferRef.current.length > 16000 * 3) {
            console.log('Triggering audio processing...');
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