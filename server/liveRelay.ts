import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, Type, type LiveServerMessage } from '@google/genai';
import { getGeminiClient, generateGeminiImage } from './gemini.ts';
import { storage } from './storage.ts';

export function setupLiveRelay(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: '/api/live-assistant',
  });

  console.log('[AURA Live] WebSocket server mounted on /api/live-assistant');

  wss.on('connection', async (clientWs: WebSocket, req) => {
    console.log('[AURA Live] Client connected to live voice session');

    let session: any = null;
    let isSessionAlive = true;
    let isTurnInterrupted = false;
    let isModelTurnActive = false;
    let pingTimer: NodeJS.Timeout | null = null;

    pingTimer = setInterval(() => {
      if (clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.ping();
        } catch {}
      }
    }, 20000);

    const cleanupTimers = () => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    };

    const reqUrl = new URL(req.url || '/api/live-assistant', 'http://localhost');
    const userId = reqUrl.searchParams.get('userId') || 'user_abhishek';
    const requestedVoice = reqUrl.searchParams.get('voiceName') || 'Zephyr';
    const validVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
    const voiceName = validVoices.includes(requestedVoice) ? requestedVoice : 'Zephyr';

    const safeSend = (payload: object) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    try {
      const ai = getGeminiClient();
      if (!ai) {
        safeSend({
          type: 'error',
          message: 'Voice service is currently offline. Please verify API configuration.',
        });
        clientWs.close();
        return;
      }

      // 1. Gather user context for AURA's system instruction
      const user = storage.getUserById(userId);
      const userName = user?.name || 'Abhishek';
      const userMemories = storage.getUserMemories(userId);
      const userTopics = storage.getUserTopics(userId);

      const memorySummary = userMemories.slice(0, 5).map(m => `- ${m.content}`).join('\n');
      const weakTopics = userTopics.filter(t => t.level === 'needs_practice' || t.needsRevision).map(t => t.topic).join(', ');

      const systemInstruction = `You are AURA, an intelligent, empathetic voice assistant and computer science study tutor for ${userName}.
You speak naturally, concisely, and warmly with real-time conversational audio.
${userName} is a 3rd-year Computer Science Engineering student preparing for software engineering placements, focusing on Data Structures & Algorithms (DSA), System Design, and Machine Learning.
${memorySummary ? `Key context about ${userName}:\n${memorySummary}` : ''}
${weakTopics ? `Topics recommended for practice: ${weakTopics}` : ''}

Key conversation guidelines:
1. Speak in natural, conversational, concise spoken sentences (1 to 3 sentences by default unless ${userName} asks for a deeper explanation).
2. Answer questions accurately about computer science, DSA, system design, coding problems, study strategies, and daily productivity.
3. DUAL-MODALITY (VOICE + VISUAL):
   When ${userName} asks for code, programming snippets, terminal commands, official website or government portal links (like Ration card, Aadhaar, etc.), comparison tables, step-by-step guides, or structured lists:
   - Speak a natural, friendly, concise verbal response (e.g. "Sure, I've displayed the Python calculator code for you." or "I've displayed the official portal link on your screen." or "Here is the comparison table between Python and Java.").
   - CONCURRENTLY invoke the displayVisualContent tool with the structured data (type, title, code/url/command/table/items).
   - For normal conversational or conceptual questions (e.g., "What is machine learning?", "How are you?", "Explain DFS intuitively"): Speak the response naturally and do NOT call displayVisualContent unless visual presentation is specifically useful.
4. MATHEMATICAL QUESTIONS & STEP-BY-STEP SOLUTIONS:
   When ${userName} asks mathematical or calculation questions (e.g., modular arithmetic, Fermat's Little Theorem, solving equations, remainders, calculus, algebra, probability, matrices):
   - Speak a concise, friendly verbal overview and final answer (e.g. "Using Fermat's Little Theorem, 127 to the power 240 modulo 241 is congruent to 1, giving a remainder of 1.").
   - Never speak raw LaTeX syntax, backslashes, or code tokens aloud.
   - Concurrently invoke displayVisualContent with type: 'math', title, mathProblem, mathSteps, and finalAnswer, presenting the clean step-by-step solution on screen.
5. You have native tool calls to interact directly with the application:
   - generateImage: generate an image, picture, or visual illustration when the user asks to generate, create, or draw an image
   - displayVisualContent: display math, code, link, command, table, steps, or list visually on the screen
   - navigateToTab: to switch to 'assistant', 'learning', 'memory', 'notes', or 'history'
   - createNote: to save a study note
   - startStudyTimer: to set a focus countdown timer
   - startRevisionTopic: to begin practicing a specific topic
   - clearConversation: to clear the conversation display
   Execute the appropriate tool immediately when ${userName} asks for these actions, then confirm briefly in your voice response.
6. CRITICAL: Never say "I am Gemini", "I am Google", "Powered by Google", or reveal backend AI provider names. If asked who you are, say: "I'm AURA, your personal voice companion and study assistant."`;

      // 2. Define tools for live interaction
      const tools = [
        {
          functionDeclarations: [
            {
              name: 'generateImage',
              description: 'Generate an image or illustration from a descriptive text prompt and display it in the application interface whenever the user asks to generate, create, draw, or show a generated image or picture.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  prompt: { type: Type.STRING, description: 'Detailed visual description of the image to generate' },
                  title: { type: Type.STRING, description: 'Short display title for the generated image' },
                },
                required: ['prompt'],
              },
            },
            {
              name: 'displayVisualContent',
              description: 'Display visual companion content (code blocks, clickable website/portal links, terminal commands, comparison tables, step-by-step guides, or structured lists) in the application interface when content needs to be read, copied, clicked, or viewed.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  type: {
                    type: Type.STRING,
                    enum: ['code', 'link', 'command', 'table', 'steps', 'list', 'math'],
                    description: 'Visual content type',
                  },
                  title: { type: Type.STRING, description: 'Title of the visual component' },
                  code: { type: Type.STRING, description: 'Full source code for code blocks' },
                  language: { type: Type.STRING, description: 'Programming language (e.g. python, cpp, javascript, bash, java)' },
                  url: { type: Type.STRING, description: 'Official or verified URL for links' },
                  urlLabel: { type: Type.STRING, description: 'Button label for link (e.g. Open Official Portal)' },
                  command: { type: Type.STRING, description: 'Terminal command (e.g. npm install react)' },
                  tableHeaders: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Column header titles for tables',
                  },
                  tableRows: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    description: 'Matrix rows for tables',
                  },
                  items: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Items for step-by-step guides or lists',
                  },
                  mathProblem: { type: Type.STRING, description: 'The mathematical problem or equation' },
                  mathSteps: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        stepNumber: { type: Type.INTEGER },
                        title: { type: Type.STRING },
                        explanation: { type: Type.STRING },
                        formula: { type: Type.STRING },
                      },
                      required: ['stepNumber', 'title'],
                    },
                    description: 'Structured pedagogical step-by-step math derivations',
                  },
                  finalAnswer: { type: Type.STRING, description: 'The boxed final answer or conclusion' },
                  summary: { type: Type.STRING, description: 'Optional short companion note' },
                },
                required: ['type'],
              },
            },
            {
              name: 'navigateToTab',
              description: 'Switch the application view to a specific tab: assistant (main voice view), learning (DSA & study progress dashboard), memory (personal context & facts), notes (voice notes), or history (past conversations).',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  tab: {
                    type: Type.STRING,
                    enum: ['assistant', 'learning', 'memory', 'notes', 'history'],
                    description: 'The destination tab identifier',
                  },
                },
                required: ['tab'],
              },
            },
            {
              name: 'createNote',
              description: 'Save a study note or idea to the user notes dashboard.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: 'Short descriptive title of the note' },
                  content: { type: Type.STRING, description: 'The body text or code snippet of the note' },
                },
                required: ['title', 'content'],
              },
            },
            {
              name: 'startStudyTimer',
              description: 'Start a focused study or problem countdown timer in the application.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  minutes: { type: Type.NUMBER, description: 'Duration in minutes (e.g. 15, 25, 45)' },
                  label: { type: Type.STRING, description: 'Study topic or problem label' },
                },
                required: ['minutes'],
              },
            },
            {
              name: 'startRevisionTopic',
              description: 'Start a revision or quiz session on a specific DSA or CS topic.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  topic: { type: Type.STRING, description: 'The CS topic (e.g., Binary Trees, Graphs, Dynamic Programming)' },
                },
                required: ['topic'],
              },
            },
            {
              name: 'clearConversation',
              description: 'Clear the current conversation messages from the screen.',
              parameters: {
                type: Type.OBJECT,
                properties: {},
              },
            },
          ],
        },
      ];

      // 3. Connect to Gemini Live API
      session = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
          systemInstruction,
          tools,
        },
        callbacks: {
          onopen: () => {
            console.log(`[AURA Live] Gemini Live session connected (voice: ${voiceName})`);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (!isSessionAlive) return;

            if ((message as any).setupComplete) {
              console.log('[AURA Live] Gemini Live setup complete, notifying client');
              safeSend({ type: 'connected' });
            }

            const content = message.serverContent;

            // Real-time user speech transcription from Gemini Live
            if (content?.inputTranscription?.text) {
              isTurnInterrupted = false;
              safeSend({
                type: 'input_transcript',
                text: content.inputTranscription.text,
              });
            }

            // Handle interruption (Barge-in detected by Gemini Live)
            if (content?.interrupted) {
              console.log('[AURA Live] Gemini Live detected interruption');
              isTurnInterrupted = true;
              isModelTurnActive = false;
              safeSend({ type: 'interrupted' });
            }

            // If interrupted by server or client, wait for turnComplete of interrupted turn
            if (isTurnInterrupted) {
              if (content?.turnComplete) {
                isTurnInterrupted = false;
                isModelTurnActive = false;
                safeSend({ type: 'turn_complete' });
              }
              return;
            }

            // Real-time assistant spoken transcription from Gemini Live
            if (content?.outputTranscription?.text) {
              isModelTurnActive = true;
              safeSend({
                type: 'transcript',
                text: content.outputTranscription.text,
                role: 'assistant',
              });
            }

            // Handle generated audio chunks & text
            const parts = content?.modelTurn?.parts;
            if (parts && parts.length > 0) {
              for (const part of parts) {
                if ((part as any).thought) continue;
                if (part.inlineData?.data) {
                  isModelTurnActive = true;
                  safeSend({
                    type: 'audio',
                    audio: part.inlineData.data,
                    mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                  });
                }
                if (part.text) {
                  isModelTurnActive = true;
                  safeSend({
                    type: 'transcript',
                    text: part.text,
                    role: 'assistant',
                  });
                }
              }
            }

            // Handle tool calls
            const toolCall = (message as any).toolCall;
            if (toolCall?.functionCalls && toolCall.functionCalls.length > 0) {
              isModelTurnActive = true;
              console.log('[AURA Live] Function call received from Live API:', toolCall.functionCalls);
              
              const functionResponses: any[] = [];
              for (const fc of toolCall.functionCalls) {
                const { name, args, id } = fc;
                let responseOutput: any = { success: true };

                if (name === 'generateImage') {
                  const imgPrompt = String(args?.prompt || '').trim();
                  const imgTitle = args?.title || (imgPrompt.length > 35 ? imgPrompt.slice(0, 35) + '...' : imgPrompt) || 'Generated Image';
                  safeSend({
                    type: 'tool_call',
                    name: 'generateImage',
                    args: { prompt: imgPrompt, title: imgTitle, status: 'generating' },
                    id,
                  });
                  const imgResult = await generateGeminiImage(imgPrompt);
                  safeSend({
                    type: 'tool_call',
                    name: 'generateImage',
                    args: {
                      prompt: imgPrompt,
                      title: imgTitle,
                      status: imgResult.success ? 'completed' : 'failed',
                      imageUrl: imgResult.imageUrl,
                      error: imgResult.error,
                    },
                    id,
                  });
                  responseOutput = imgResult.success
                    ? { success: true, displayed: true, title: imgTitle }
                    : { success: false, error: imgResult.error || 'Failed to generate image' };
                  functionResponses.push({
                    name,
                    id,
                    response: { result: responseOutput },
                  });
                  continue;
                }

                // Execute server-side actions where relevant
                if (name === 'displayVisualContent') {
                  responseOutput = { success: true, displayed: true };
                } else if (name === 'createNote') {
                  const newNote = storage.addNote({
                    userId,
                    title: args.title || 'Voice Note',
                    content: args.content || '',
                    tags: ['Voice', 'Study'],
                  });
                  responseOutput = { success: true, noteId: newNote.id, message: 'Note saved successfully' };
                } else if (name === 'startStudyTimer') {
                  responseOutput = { success: true, minutes: args.minutes, label: args.label || 'Study Timer' };
                } else if (name === 'navigateToTab') {
                  responseOutput = { success: true, tab: args.tab };
                } else if (name === 'startRevisionTopic') {
                  responseOutput = { success: true, topic: args.topic };
                } else if (name === 'clearConversation') {
                  responseOutput = { success: true };
                }

                // Notify frontend client to trigger UI action
                safeSend({
                  type: 'tool_call',
                  name,
                  args,
                  id,
                });

                functionResponses.push({
                  name,
                  id,
                  response: { result: responseOutput },
                });
              }

              // Send tool response back to Gemini Live session
              try {
                session.sendToolResponse({ functionResponses });
              } catch (err) {
                console.warn('[AURA Live] Error sending tool response:', err);
              }
            }

            // Handle turn complete
            if (message.serverContent?.turnComplete) {
              isModelTurnActive = false;
              safeSend({ type: 'turn_complete' });
            }
          },
          onerror: (err: any) => {
            console.log('[AURA Live] Gemini Live session notice:', err?.message || err);
            isSessionAlive = false;
            cleanupTimers();
            safeSend({
              type: 'error',
              message: 'Voice session encountered a temporary interruption. Reconnecting...',
            });
            try {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.close();
              }
            } catch {}
          },
          onclose: (event: any) => {
            console.log('[AURA Live] Gemini Live session closed:', event?.reason || '');
            isSessionAlive = false;
            session = null;
            cleanupTimers();
            safeSend({ type: 'closed' });
            try {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.close();
              }
            } catch {}
          },
        },
      });

      // 4. Handle client incoming messages
      clientWs.on('message', (data: any) => {
        if (!isSessionAlive || !session) return;
        try {
          const msg = JSON.parse(data.toString());

          // Real-time audio chunk (16kHz PCM raw 16-bit little-endian)
          if (msg.type === 'realtime_audio' && msg.audio) {
            session.sendRealtimeInput({
              audio: {
                data: msg.audio,
                mimeType: 'audio/pcm;rate=16000',
              },
            });
          } else if (msg.type === 'interrupt') {
            console.log('[AURA Live] Client-side fast barge-in interruption signal received');
            if (isModelTurnActive) {
              isTurnInterrupted = true;
              isModelTurnActive = false;
            }
          } else if (msg.type === 'tool_response' && msg.responses) {
            session.sendToolResponse({ functionResponses: msg.responses });
          } else if (msg.type === 'text' && msg.text) {
            isTurnInterrupted = false;
            isModelTurnActive = false;
            // Text input support
            session.sendClientContent({
              turns: [{ role: 'user', parts: [{ text: msg.text }] }],
              turnComplete: true,
            });
          }
        } catch (err: any) {
          console.log('[AURA Live] Client message handling notice:', err?.message || err);
        }
      });

      clientWs.on('close', () => {
        isSessionAlive = false;
        cleanupTimers();
        console.log('[AURA Live] Client WebSocket closed');
        if (session) {
          try {
            session.close();
          } catch {}
          session = null;
        }
      });

      clientWs.on('error', (err: any) => {
        isSessionAlive = false;
        cleanupTimers();
        console.log('[AURA Live] Client WebSocket notice:', err?.message || err);
        if (session) {
          try {
            session.close();
          } catch {}
          session = null;
        }
      });

    } catch (err: any) {
      cleanupTimers();
      console.log('[AURA Live] Live session setup notice:', err?.message || err);
      safeSend({
        type: 'error',
        message: 'Could not establish real-time voice connection. Please try again.',
      });
      clientWs.close();
    }
  });
}
