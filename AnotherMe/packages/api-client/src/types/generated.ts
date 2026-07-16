/**
 * Auto-generated from Gateway OpenAPI spec.
 * Source: ./openapi.json
 * Generated at: 2026-06-02T14:22:37.132Z
 *
 * DO NOT EDIT — run `pnpm generate` to refresh.
 */
export interface paths {
    "/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Gateway root */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Gateway metadata */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RootResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/healthz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness + Redis check */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Health status */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["HealthResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all capabilities, effective capabilities, and tools */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Capability registry snapshot */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CapabilitiesResponse"];
                    };
                };
                401: components["responses"]["Unauthorized"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/capabilities/{capability_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a single capability */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    capability_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Capability definition */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Capability"];
                    };
                };
                401: components["responses"]["Unauthorized"];
                404: components["responses"]["NotFound"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tools/{tool_id}/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Update a tool's health status */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    tool_id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        available: boolean;
                        error_message?: string;
                    };
                };
            };
            responses: {
                /** @description Tool health updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            tool_id?: string;
                            available?: boolean;
                            affected_capabilities?: string[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a generation job (course / problem video / study package / learning record) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateJobRequest"];
                };
            };
            responses: {
                /** @description Job created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["JobSummary"];
                    };
                };
                401: components["responses"]["Unauthorized"];
                503: components["responses"]["ServiceUnavailable"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{job_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a job's status */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    job_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Job summary */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["JobSummary"];
                    };
                };
                404: components["responses"]["NotFound"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{job_id}/result": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a job's final result payload */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    job_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Job result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["JobResultResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{job_id}/trace-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get trace events emitted by the job */
        get: {
            parameters: {
                query?: {
                    event_type?: string;
                };
                header?: never;
                path: {
                    job_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Trace events */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TraceEvent"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{job_id}/capability-guard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Re-check capability availability for a job */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    job_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Capability guard result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CapabilityGuardResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upload a file (typically a problem photo) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "multipart/form-data": {
                        /** Format: binary */
                        file: string;
                    };
                };
            };
            responses: {
                /** @description Upload accepted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UploadResponse"];
                    };
                };
                400: components["responses"]["NotFound"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/ai/chat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Stream chat via Server-Sent Events
         * @description Streams `agent_start`, `thinking`, `text_delta`, `done`/`error` events.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ChatRequest"];
                };
            };
            responses: {
                /** @description SSE stream of chat events */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/event-stream": components["schemas"]["StreamEvent_AgentStart"] | components["schemas"]["StreamEvent_Thinking"] | components["schemas"]["StreamEvent_TextDelta"] | components["schemas"]["StreamEvent_Done"] | components["schemas"]["StreamEvent_Error"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/ai/chat/non-streaming": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Non-streaming chat (collects all events and returns final text) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ChatRequest"];
                };
            };
            responses: {
                /** @description Final assistant text */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ChatNonStreamingResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/ai/learning/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create an AI chat session */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Session created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/ai/learning/sessions/{session_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List messages in an AI chat session */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    session_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description List of messages */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
        };
        put?: never;
        /** Append a message to an AI chat session */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    session_id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateMessageRequest"];
                };
            };
            responses: {
                /** @description Message stored */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageOutput"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/messages/conversations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List conversations for a user */
        get: {
            parameters: {
                query: {
                    user_id: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Conversations */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ConversationSummary"][];
                    };
                };
            };
        };
        put?: never;
        /** Create a conversation */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateConversationRequest"];
                };
            };
            responses: {
                /** @description Conversation created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ConversationSummary"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/messages/conversations/{conversation_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List messages in a conversation */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    conversation_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Messages */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageOutput"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/students/{user_id}/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a student's learning profile */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    user_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Student profile */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StudentProfileOutput"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/students/{user_id}/knowledge-states": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List knowledge states for a student */
        get: {
            parameters: {
                query?: {
                    knowledge_point_id?: string;
                    limit?: number;
                };
                header?: never;
                path: {
                    user_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Knowledge states */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StudentKnowledgeStateOutput"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/students/{user_id}/knowledge-tracing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a student's knowledge tracing summary */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    user_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Knowledge tracing summary */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/students/{user_id}/quiz-answers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Process a quiz answer and update knowledge state */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    user_id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ProcessQuizAnswerInput"];
                };
            };
            responses: {
                /** @description Quiz answer result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["QuizAnswerResultOutput"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/students/{user_id}/learning-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List learning events for a student */
        get: {
            parameters: {
                query?: {
                    limit?: number;
                };
                header?: never;
                path: {
                    user_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Learning events */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LearningEventOutput"][];
                    };
                };
            };
        };
        put?: never;
        /** Record a learning event */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    user_id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateLearningEventRequest"];
                };
            };
            responses: {
                /** @description Event recorded */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LearningEventOutput"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/students/{user_id}/learning-events/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get learning event statistics */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    user_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Statistics */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LearningEventStatsOutput"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/students/{user_id}/diagnostic-probes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate a diagnostic probe */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    user_id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            responses: {
                /** @description Generated probe */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DiagnosticProbeOutput"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/knowledge-points": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List knowledge points */
        get: {
            parameters: {
                query?: {
                    subject?: string;
                    parent_id?: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Knowledge points */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["KnowledgePointOutput"][];
                    };
                };
            };
        };
        put?: never;
        /** Upsert a knowledge point */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["KnowledgePointInput"];
                };
            };
            responses: {
                /** @description Knowledge point stored */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["KnowledgePointOutput"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/classrooms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List classrooms (most recent first) */
        get: {
            parameters: {
                query?: {
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Classrooms */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ClassroomListResponse"];
                    };
                };
            };
        };
        put?: never;
        /** Create a classroom (called by Web app via Next.js) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateClassroomRequest"];
                };
            };
            responses: {
                /** @description Classroom created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CreateClassroomResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/classrooms/{classroom_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a classroom (mobile entry-point) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    classroom_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Classroom data */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ClassroomDetailResponse"];
                    };
                };
                404: components["responses"]["NotFound"];
            };
        };
        put?: never;
        post?: never;
        /** Delete a classroom */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    classroom_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Classroom deleted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DeleteClassroomResponse"];
                    };
                };
                404: components["responses"]["NotFound"];
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Live-book subsystem health */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Engine availability + book counts */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List books */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Books */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Book"][];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        /** Create a new book from a proposal */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ConfirmProposalRequest"];
                };
            };
            responses: {
                /** @description Book created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Book"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/confirm-proposal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm a book proposal (alias of POST /books) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ConfirmProposalRequest"];
                };
            };
            responses: {
                /** @description Book created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Book"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/confirm-spine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm/override a book's spine */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ConfirmSpineRequest"];
                };
            };
            responses: {
                /** @description Book updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Book"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/compile-page": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Compile a single page (trigger block generation) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CompilePageRequest"];
                };
            };
            responses: {
                /** @description Page compile started */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Page"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/regenerate-block": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Regenerate a block (with optional user feedback) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["RegenerateBlockRequest"];
                };
            };
            responses: {
                /** @description Block regenerated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Block"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/insert-block": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Insert a new block into a page */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["InsertBlockRequest"];
                };
            };
            responses: {
                /** @description Block inserted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Block"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/delete-block": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Delete a block */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["DeleteBlockRequest"];
                };
            };
            responses: {
                /** @description Block deleted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SuccessResponse"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/move-block": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Re-order a block within its page */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["MoveBlockRequest"];
                };
            };
            responses: {
                /** @description Block moved */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Page"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/change-block-type": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Change a block's type (e.g. text -> callout) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ChangeBlockTypeRequest"];
                };
            };
            responses: {
                /** @description Block type changed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Block"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/quiz-attempt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Submit a quiz answer; returns feedback + updated mastery */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["QuizAttemptRequest"];
                };
            };
            responses: {
                /** @description Quiz graded */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/deep-dive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Open a deep-dive expansion of a block */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["DeepDiveRequest"];
                };
            };
            responses: {
                /** @description Deep-dive created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Block"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/supplement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Supplements a block with extra materials (RAG / web) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["SupplementRequest"];
                };
            };
            responses: {
                /** @description Supplement added */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Block"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/{book_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a single book */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    book_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Book */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Book"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        /** Delete a book */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    book_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Book deleted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SuccessResponse"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/{book_id}/spine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a book's spine (table of contents) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    book_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Spine */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SpineEntry"][];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/{book_id}/pages/{page_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a single page (incl. blocks) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    book_id: string;
                    page_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Page */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Page"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/{book_id}/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Per-book health / state snapshot */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    book_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Health */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/books/{book_id}/refresh-fingerprints": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Refresh all block fingerprints (cache busting) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    book_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Refreshed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SuccessResponse"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List available book sources */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Sources */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SourceListResponse"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        /** Create a new book source */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateSourceRequest"];
                };
            };
            responses: {
                /** @description Source created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SourceOption"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/live-book/jobs/{job_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a live-book job's status */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    job_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Job */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["JobSummary"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/co-writer/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List co-writer documents */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Documents */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CoWriterDocument"][];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        /** Create a co-writer document */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CoWriterCreateRequest"];
                };
            };
            responses: {
                /** @description Document created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CoWriterDocument"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/co-writer/documents/{doc_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a co-writer document */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    doc_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Document */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CoWriterDocument"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        /** Update a co-writer document */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    doc_id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CoWriterUpdateRequest"];
                };
            };
            responses: {
                /** @description Document updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CoWriterDocument"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        post?: never;
        /** Delete a co-writer document */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    doc_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Document deleted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SuccessResponse"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/co-writer/edit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** One-shot edit (selection + instruction) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CoWriterEditRequest"];
                };
            };
            responses: {
                /** @description Edit result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CoWriterEditResponse"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/co-writer/edit_react/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Streaming ReAct-style edit (SSE) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CoWriterEditRequest"];
                };
            };
            responses: {
                /** @description SSE stream of edit events */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/event-stream": {
                            [key: string]: unknown;
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/co-writer/edit_react": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Non-streaming ReAct-style edit (full result) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CoWriterEditRequest"];
                };
            };
            responses: {
                /** @description Edit result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CoWriterEditResponse"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/co-writer/automark": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Auto-mark a document (highlight issues) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CoWriterAutoMarkRequest"];
                };
            };
            responses: {
                /** @description Auto-mark result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/co-writer/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List edit history for the current user */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description History */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        }[];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/co-writer/history/{operation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a single history entry */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    operation_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Operation */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        };
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/co-writer/tool_calls/{operation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get tool-call trace for a history entry */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    operation_id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Tool calls */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        }[];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the current user (stub in Phase 0 / Phase 1) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description User */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["User"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update the current user */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["UserUpdateRequest"];
                };
            };
            responses: {
                /** @description User updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["User"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        trace?: never;
    };
    "/v1/courses/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate a course (alias of POST /v1/jobs with job_type=course_generate) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CourseGenerateRequest"];
                };
            };
            responses: {
                /** @description Job created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["JobSummary"];
                    };
                };
                default: components["responses"]["Error"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/generate/image": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate an image (Seedream/Qwen/NanoBanana/etc.) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "x-image-provider"?: string;
                    "x-api-key"?: string;
                    "x-base-url"?: string;
                    "x-image-model"?: string;
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ImageGenerationRequest"];
                };
            };
            responses: {
                /** @description Image generated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ImageGenerationResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/generate/tts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate TTS audio (OpenAI/Azure/MiniMax/etc.) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["TTSRequest"];
                };
            };
            responses: {
                /** @description Audio generated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TTSResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/generate/video": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate a video (Seedance/Kling/Veo/MiniMax/etc.) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["VideoGenerationRequest"];
                };
            };
            responses: {
                /** @description Video generated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["VideoGenerationResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/transcribe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Transcribe an audio object to text */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["TranscriptionRequest"];
                };
            };
            responses: {
                /** @description Transcription */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TranscriptionResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/documents/parse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Parse a PDF/document into structured content */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            responses: {
                /** @description Parsed document */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/web-search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Web search */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        query: string;
                        /** @default 5 */
                        top_k?: number;
                    };
                };
            };
            responses: {
                /** @description Search results */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/server-config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get public server configuration (feature flags, model list) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Server config */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        APIError: {
            /**
             * @description Machine-readable error code (UPPER_SNAKE_CASE).
             * @example INTERNAL_ERROR
             */
            error_code: string;
            /** @example Internal server error */
            message: string;
            /** @description Echoed from X-Request-Id header, or auto-minted. */
            request_id: string;
            details?: {
                [key: string]: unknown;
            };
        };
        /** @enum {string} */
        JobType: "course_generate" | "problem_video_generate" | "study_package_generate" | "learning_record_extract";
        /** @enum {string} */
        JobStatus: "queued" | "running" | "succeeded" | "failed";
        HealthResponse: {
            ok: boolean;
            redis?: boolean;
            queue_backend?: string;
            env?: string;
        };
        RootResponse: {
            service: string;
            ok: boolean;
            health?: string;
            api?: string;
        };
        Capability: {
            /** @example ai_tutor_chat */
            id: string;
            name: string;
            description: string;
            required_tools: string[];
            optional_tools: string[];
            enabled: boolean;
            status?: string;
            config?: {
                [key: string]: unknown;
            };
            icon?: string;
            category?: string;
        };
        Tool: {
            id: string;
            name: string;
            description: string;
            available: boolean;
            config?: {
                [key: string]: unknown;
            };
            provider?: string;
            /** Format: date-time */
            last_health_check?: string;
            error_message?: string;
        };
        CapabilitiesResponse: {
            capabilities: {
                [key: string]: components["schemas"]["Capability"];
            };
            effective: components["schemas"]["Capability"][];
            tools: {
                [key: string]: components["schemas"]["Tool"];
            };
        };
        CapabilityGuardResponse: {
            job_id?: string;
            capability_id?: string;
            ok?: boolean;
            missing_tools?: string[];
            degraded?: boolean;
        };
        CreateJobRequest: {
            job_type: components["schemas"]["JobType"];
            payload: {
                [key: string]: unknown;
            };
            /** @default default_user */
            user_id: string;
        };
        JobSummary: {
            job_id: string;
            job_type: components["schemas"]["JobType"];
            status: components["schemas"]["JobStatus"];
            progress: number;
            step: string;
            error_code?: string;
            error_message?: string;
            result?: {
                [key: string]: unknown;
            };
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
        };
        JobResultResponse: {
            job_id: string;
            status: components["schemas"]["JobStatus"];
            result: {
                [key: string]: unknown;
            };
        };
        TraceEvent: {
            [key: string]: unknown;
        };
        UploadResponse: {
            object_key: string;
            url: string;
            size: number;
            content_type: string;
        };
        ChatMessage: {
            /** @enum {string} */
            role: "system" | "user" | "assistant";
            content: string | {
                type: string;
                text: string;
            }[];
        };
        ChatRequest: {
            messages: components["schemas"]["ChatMessage"][];
            /** @default gpt-4o */
            model: string;
            /** @default  */
            api_key: string;
            base_url?: string;
            /** @default 0.1 */
            temperature: number;
            /** @default 4096 */
            max_tokens: number;
            system_prompt?: string;
            /**
             * @description One of: ai_tutor_chat, deep_solve, deep_research, course_generate, problem_video_generate, math_animator, visualize, co_writer, quiz_practice, interactive_demo
             * @default ai_tutor_chat
             */
            capability: string;
            /** @default true */
            streaming: boolean;
            /** @default anonymous */
            user_id: string;
            request_id?: string;
            learning_context?: {
                [key: string]: unknown;
            };
        };
        ChatNonStreamingResponse: {
            success: boolean;
            assistant_text: string;
            request_id: string;
        };
        StreamEvent_AgentStart: {
            /** @constant */
            type: "agent_start";
            data: {
                messageId: string;
                agentId: string;
                agentName: string;
            };
        };
        StreamEvent_Thinking: {
            /** @constant */
            type: "thinking";
            data: {
                stage: string;
                agentId: string;
                reasoning: string;
            };
        };
        StreamEvent_TextDelta: {
            /** @constant */
            type: "text_delta";
            data: {
                content: string;
                messageId: string;
            };
        };
        StreamEvent_Done: {
            /** @constant */
            type: "done";
            data: {
                totalActions: number;
                totalAgents: number;
                agentHadContent: boolean;
            };
        };
        StreamEvent_Error: {
            /** @constant */
            type: "error";
            data: {
                message: string;
            };
        };
        ClassroomSummary: {
            id: string;
            title: string;
            created_at: string;
            scenes_count: number;
        };
        ClassroomListResponse: {
            success: boolean;
            classrooms: components["schemas"]["ClassroomSummary"][];
        };
        ClassroomData: {
            [key: string]: unknown;
        };
        ClassroomDetailResponse: {
            success: boolean;
            classroom: components["schemas"]["ClassroomData"];
        };
        CreateClassroomRequest: {
            stage: {
                [key: string]: unknown;
            };
            scenes?: {
                [key: string]: unknown;
            }[];
        };
        CreateClassroomResponse: {
            success: boolean;
            id: string;
        };
        DeleteClassroomResponse: {
            success: boolean;
            deleted: boolean;
        };
        ImageGenerationRequest: {
            prompt: string;
            negative_prompt?: string;
            /** @default 1024 */
            width: number;
            /** @default 1024 */
            height: number;
            aspect_ratio?: string;
            style?: string;
        };
        ImageGenerationResult: {
            base64: string;
            format: string;
            width: number;
            height: number;
        };
        ImageGenerationResponse: {
            success: boolean;
            result: components["schemas"]["ImageGenerationResult"];
        };
        TTSRequest: {
            text: string;
            audio_id: string;
            /** @default openai-tts */
            tts_provider_id: string;
            /** @default alloy */
            tts_voice: string;
            tts_model_id?: string;
            /** @default 1 */
            tts_speed: number;
            tts_api_key?: string;
            tts_base_url?: string;
        };
        TTSResponse: {
            success: boolean;
            url: string;
            audio_id?: string;
        };
        VideoGenerationRequest: {
            prompt: string;
            /** @default 5 */
            duration: number;
            /** @default 16:9 */
            aspect_ratio: string;
            /** @default 720p */
            resolution: string;
        };
        VideoGenerationResponse: {
            success: boolean;
            url?: string;
        };
        ConversationSummary: {
            conversation_id: string;
            type: string;
            name: string;
            creator_id: string;
            last_message_id?: string;
            last_message_time?: string;
            unread_count?: number;
            created_at: string;
            updated_at: string;
        };
        CreateConversationRequest: {
            user_id: string;
            /** @default single */
            type: string;
            name: string;
            creator_id?: string;
            member_ids?: string[];
        };
        CreateMessageRequest: {
            sender_id: string;
            /** @default text */
            message_type: string;
            content: string;
            reply_to_message_id?: string;
            /** @default sent */
            status: string;
            /** @default manual */
            source_type: string;
            source_ref_id?: string;
            attachments?: {
                [key: string]: unknown;
            }[];
        };
        MessageOutput: {
            message_id: string;
            conversation_id: string;
            seq: number;
            sender_id: string;
            message_type: string;
            content: string;
            reply_to_message_id?: string;
            status: string;
            source_type: string;
            source_ref_id?: string;
            recalled_flag?: boolean;
            deleted_flag?: boolean;
            created_at: string;
            attachments?: {
                [key: string]: unknown;
            }[];
        };
        StudentProfileOutput: {
            user_id: string;
            weak_subjects?: string[];
            weak_knowledge_points?: string[];
            recent_focus?: string;
            ability_scores?: {
                [key: string]: unknown;
            }[];
            learning_stats: {
                [key: string]: unknown;
            };
            updated_at?: string;
            computed_at: string;
            profile_source: string;
            knowledge_tracing?: {
                [key: string]: unknown;
            }[];
        };
        StudentKnowledgeStateOutput: {
            user_id: string;
            knowledge_point_id: string;
            p_mastery: number;
            p_learn: number;
            p_guess: number;
            p_slip: number;
            p_forget?: number;
            attempts: number;
            correct_attempts: number;
            last_updated_at?: string;
        };
        ProcessQuizAnswerInput: {
            question_id: string;
            is_correct: boolean;
            knowledge_point_ids?: string[];
            payload?: {
                [key: string]: unknown;
            };
        };
        QuizAnswerResultOutput: {
            knowledge_point_id: string;
            prior_mastery: number;
            posterior_mastery: number;
            attempts: number;
            correct_attempts: number;
            weight: number;
            difficulty?: string;
        };
        DiagnosticProbeOutput: {
            probe_id: string;
            knowledge_point_id: string;
            question: string;
            options?: string[];
            correct_answer: string;
            explanation: string;
            difficulty: string;
            probe_type: string;
            hints: string[];
            teaching_action: string;
            reason: string;
        };
        LearningEventOutput: {
            event_id: string;
            user_id: string;
            event_type: string;
            session_id?: string;
            classroom_id?: string;
            scene_id?: string;
            block_id?: string;
            knowledge_points?: string[];
            payload?: {
                [key: string]: unknown;
            };
            weight: number;
            created_at: string;
        };
        CreateLearningEventRequest: {
            user_id?: string;
            event_type: string;
            session_id?: string;
            classroom_id?: string;
            scene_id?: string;
            block_id?: string;
            knowledge_points?: string[];
            payload?: {
                [key: string]: unknown;
            };
            /** @default 1 */
            weight: number;
        };
        LearningEventStatsOutput: {
            total_events: number;
            by_type?: {
                [key: string]: unknown;
            }[];
            knowledge_points_involved?: string[];
        };
        KnowledgePointOutput: {
            id: string;
            subject?: string;
            name: string;
            description?: string;
            parent_id?: string;
            prerequisites: string[];
            difficulty?: string;
            created_at: string;
        };
        KnowledgePointInput: {
            kp_id: string;
            name: string;
            subject?: string;
            description?: string;
            parent_id?: string;
            prerequisites?: string[];
            difficulty?: string;
        };
        LiveBook: {
            [key: string]: unknown;
        };
        LiveBookPage: {
            [key: string]: unknown;
        };
        Block: {
            id: string;
            /** @enum {string} */
            type: "text" | "callout" | "quiz" | "user_note" | "figure" | "interactive" | "animation" | "code" | "timeline" | "flash_cards" | "deep_dive" | "section" | "concept_graph";
            /** @enum {string} */
            status: "pending" | "generating" | "ready" | "error" | "hidden";
            payload?: {
                [key: string]: unknown;
            };
            fingerprint?: string;
        };
        CoWriterDoc: {
            [key: string]: unknown;
        };
        TranscriptionRequest: {
            audio_id: string;
            object_key: string;
            /** @default zh */
            language: string;
            asr_provider_id?: string;
            asr_model_id?: string;
        };
        TranscriptionResponse: {
            success: boolean;
            text: string;
            language?: string;
            segments?: {
                [key: string]: unknown;
            }[];
        };
        SuccessResponse: {
            success: boolean;
        };
        ErrorEnvelope: {
            error_code: string;
            message: string;
            request_id: string;
            details?: {
                [key: string]: unknown;
            };
        };
        User: {
            user_id: string;
            /** Format: email */
            email?: string;
            display_name?: string;
            /** Format: uri */
            avatar_url?: string;
            /** @example zh-CN */
            locale?: string;
            /** Format: date-time */
            created_at?: string;
        };
        UserUpdateRequest: {
            display_name?: string;
            /** Format: uri */
            avatar_url?: string;
            locale?: string;
        };
        Book: {
            id: string;
            title: string;
            subject?: string;
            grade?: string;
            /** @enum {string} */
            status: "draft" | "spine_ready" | "compiling" | "ready" | "error" | "archived";
            spine?: components["schemas"]["SpineEntry"][];
            metadata?: {
                [key: string]: unknown;
            };
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
        };
        SpineEntry: {
            page_id: string;
            title: string;
            order: number;
            /** @enum {string} */
            content_type?: "theory" | "derivation" | "history" | "practice" | "concept" | "overview";
            objective?: string;
        };
        Page: {
            id: string;
            book_id: string;
            title: string;
            order: number;
            content_type?: string;
            /** @enum {string} */
            status: "pending" | "planning" | "generating" | "ready" | "partial" | "error";
            blocks: components["schemas"]["Block"][];
            /** Format: date-time */
            created_at?: string;
            /** Format: date-time */
            updated_at?: string;
        };
        BookProposal: {
            title: string;
            subject?: string;
            grade?: string;
            intent?: string;
            source_refs?: string[];
            spine: components["schemas"]["SpineEntry"][];
        };
        ConfirmProposalRequest: {
            proposal: components["schemas"]["BookProposal"];
        };
        ConfirmSpineRequest: {
            book_id: string;
            spine: components["schemas"]["SpineEntry"][];
        };
        CompilePageRequest: {
            book_id: string;
            page_id: string;
            /** @default false */
            force: boolean;
        };
        RegenerateBlockRequest: {
            book_id: string;
            block_id: string;
            feedback?: string;
        };
        InsertBlockRequest: {
            book_id: string;
            page_id: string;
            type: string;
            payload?: {
                [key: string]: unknown;
            };
            order: number;
        };
        DeleteBlockRequest: {
            book_id: string;
            block_id: string;
        };
        MoveBlockRequest: {
            book_id: string;
            block_id: string;
            new_order: number;
        };
        ChangeBlockTypeRequest: {
            book_id: string;
            block_id: string;
            new_type: string;
        };
        QuizAttemptRequest: {
            book_id: string;
            block_id: string;
            answer: string;
        };
        DeepDiveRequest: {
            book_id: string;
            block_id: string;
            topic: string;
        };
        SupplementRequest: {
            book_id: string;
            block_id: string;
            query: string;
        };
        SourceOption: {
            id: string;
            label: string;
            kind: string;
        };
        SourceListResponse: {
            sources: components["schemas"]["SourceOption"][];
        };
        CreateSourceRequest: {
            label: string;
            kind: string;
            config?: {
                [key: string]: unknown;
            };
        };
        CourseGenerateRequest: {
            prompt: string;
            subject?: string;
            grade?: string;
            /** @default 45 */
            duration_minutes: number;
            /**
             * @description Must equal `course_generate`.
             * @default course_generate
             */
            capability: string;
        };
        CoWriterDocument: {
            id: string;
            title: string;
            content: string;
            tags?: string[];
            metadata?: {
                [key: string]: unknown;
            };
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
        };
        CoWriterCreateRequest: {
            title: string;
            /** @default  */
            content: string;
            tags?: string[];
        };
        CoWriterUpdateRequest: {
            title?: string;
            content?: string;
            tags?: string[];
        };
        CoWriterEditRequest: {
            doc_id: string;
            selection: string;
            instruction: string;
        };
        CoWriterEditResponse: {
            doc_id: string;
            patched_selection: string;
            diff?: string;
        };
        CoWriterAutoMarkRequest: {
            doc_id: string;
        };
    };
    responses: {
        /** @description Error envelope (unified across all routes since P1) */
        Error: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["APIError"];
            };
        };
        /** @description Missing or invalid bearer token */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["APIError"];
            };
        };
        /** @description Resource not found */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["APIError"];
            };
        };
        /** @description Capability unavailable (missing tools) */
        ServiceUnavailable: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["APIError"];
            };
        };
    };
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
