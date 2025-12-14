import { useState, useRef, useEffect, useCallback } from 'react';
import { ConnectionState } from '../types';
import { downsampleBuffer, encodeWAV, arrayBufferToBase64, convertInt16ToFloat32 } from '../utils/audio-utils';
import { pipeline, env } from '@xenova/transformers';

// Ensure we load models from the CDN/Hugging Face directly
env.allowLocalModels = false;
env.useBrowserCache = true;

interface MiniOmniConfig {
  serverUrl: string;
  instruction: string;
}

const TARGET_SAMPLE_RATE = 24000;

export const useLocalTranslator = (config: MiniOmniConfig) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [serverStatus, setServerStatus] = useState<'connected' | 'disconnected' | 'unknown'>('unknown');
  
  const [sourceStream, setSourceStream] = useState<MediaStream | null>(null);

  // Audio Processing
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioBufferRef = useRef<Float32Array>(new Float32Array(0));
  
  // Processing State
  const isProcessingRef = useRef<boolean>(false);
  
  // Audio Playback
  const nextStartTimeRef = useRef<number>(0);

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

  const checkConnection = useCallback(async () => {
    try {
      setServerStatus('unknown');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      await fetch(config.serverUrl, { 
          method: 'GET',
          mode: 'no-cors',
          signal: controller.signal 
      });
      
      clearTimeout(timeoutId);
      setServerStatus('connected');
      return true;
    } catch (err) {
      setServerStatus('disconnected');
      return false;
    }
  }, [config.serverUrl]);

  const scheduleAudioChunk = async (chunk: Uint8Array) => {
    try {
        if (!outputContextRef.current) {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            outputContextRef.current = new AudioContextClass();
        }
        const ctx = outputContextRef.current;
        if (ctx.state === 'suspended') await ctx.resume();

        const float32Data = convertInt16ToFloat32(chunk);
        
        const buffer = ctx.createBuffer(1, float32Data.length, TARGET_SAMPLE_RATE);
        buffer.copyToChannel(float32Data, 0);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        if (nextStartTimeRef.current < ctx.currentTime) {
            nextStartTimeRef.current = ctx.currentTime;
        }

        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += buffer.duration;

    } catch (e) {
        console.error("Error scheduling audio chunk:", e);
    }
  };

  const sendAudioPayload = async (audioData: Float32Array, sampleRate: number) => {
      try {
        const wavBuffer = encodeWAV(audioData, sampleRate);
        const base64Audio = arrayBufferToBase64(wavBuffer);
        
        const response = await fetch(config.serverUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audio: base64Audio,
                stream_stride: 4,
                max_tokens: 2048,
                // We optionally send prompt, but this method relies on the audio itself being the prompt
                prompt: config.instruction 
            })
        });

        if (!response.ok) {
            throw new Error(`Server Error: ${response.status}`);
        }
        
        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                await scheduleAudioChunk(value);
            }
        }
      } catch (err: any) {
        console.error("Send payload failed:", err);
        throw err;
      }
  };

  const generateAndSendInstruction = async () => {
    try {
      setStatusMessage('Initializing TTS Model...');
      console.log("Loading TTS pipeline...");
      
      // Using SpeechT5 (English) as it is robust and public. 
      // Ensure your instruction text is in English.
      const synthesizer = await pipeline('text-to-speech', 'Xenova/speecht5_tts', {
        progress_callback: (data: any) => {
            if (data.status === 'progress') {
                setStatusMessage(`Loading TTS: ${Math.round(data.progress)}%`);
            }
        }
      });

      setStatusMessage('Generating Instruction Audio...');
      console.log("Synthesizing instruction:", config.instruction);
      
      // SpeechT5 requires speaker embeddings
      const speaker_embeddings = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/speaker_embeddings.bin';
      
      const out = await synthesizer(config.instruction, { speaker_embeddings });
      
      setStatusMessage('Sending Instruction...');
      
      await sendAudioPayload(out.audio, out.sampling_rate);
      
      console.log("Instruction sent successfully.");
      
    } catch (e: any) {
      console.error("TTS generation failed:", e);
      setStatusMessage('TTS Failed, skipping instruction...');
      // Allow user to see the error briefly
      await new Promise(r => setTimeout(r, 2000));
    }
  };

  const processAudioBuffer = async () => {
    if (isProcessingRef.current || audioBufferRef.current.length === 0) {
      return;
    }

    if (audioBufferRef.current.length < TARGET_SAMPLE_RATE * 2) {
      return;
    }

    isProcessingRef.current = true;
    const inputData = audioBufferRef.current; 
    audioBufferRef.current = new Float32Array(0); 

    let sum = 0;
    for (let i = 0; i < inputData.length; i += 100) {
        sum += Math.abs(inputData[i]);
    }
    const avg = sum / (inputData.length / 100);
    if (avg < 0.01) {
        isProcessingRef.current = false;
        return;
    }

    try {
      setStatusMessage('Translating...');
      await sendAudioPayload(inputData, TARGET_SAMPLE_RATE);
      setStatusMessage('Listening...');
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message || 'Send Failed'}`);
    } finally {
      isProcessingRef.current = false;
    }
  };

  const startTranslation = useCallback(async () => {
    let stream: MediaStream | null = null;

    try {
      setConnectionState(ConnectionState.CONNECTING);
      setError(null);

      // 1. Generate and Send TTS Instruction First
      if (config.instruction && config.instruction.trim().length > 0) {
          await generateAndSendInstruction();
      }

      // 2. Start Microphone/Tab Audio
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

      setSourceStream(stream);

      if (stream.getAudioTracks().length === 0) {
          stream.getTracks().forEach(track => track.stop());
          throw new Error("No audio found! Check 'Also share tab audio'.");
      }
      
      stream.getVideoTracks().forEach(track => track.stop());
      
      const connected = await checkConnection();
      if (!connected) {
          console.warn(`Connection check to ${config.serverUrl} failed.`);
      }
      
      setStatusMessage('Listening...');

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass({ sampleRate: 44100 });
      inputContextRef.current = ctx;

      if (ctx.state === 'suspended') await ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const downsampled = downsampleBuffer(inputData, ctx.sampleRate, TARGET_SAMPLE_RATE);

        const newBuffer = new Float32Array(audioBufferRef.current.length + downsampled.length);
        newBuffer.set(audioBufferRef.current);
        newBuffer.set(downsampled, audioBufferRef.current.length);
        audioBufferRef.current = newBuffer;

        if (!isProcessingRef.current && audioBufferRef.current.length > TARGET_SAMPLE_RATE * 3) {
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
  }, [cleanup, config, checkConnection]);

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
    serverStatus,
    checkConnection
  };
};