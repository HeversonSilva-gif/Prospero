/// <reference types="vite/client" />
import type {
  ApiKeyStatus,
  AppSettings,
  DetectResult,
  RecoveryResult,
  RecoveryStatusEvent,
  TokenSource,
  TokenStatus,
  Agent,
  AgentEvent,
  AgentStats,
  Company,
  Message,
  InboxItem,
  PermissionRequest,
  PermissionResolution,
  Project,
  ProjectPathStatus,
  Issue,
  IssueArtifact,
  IssueDetail,
  IssueComment,
  IssueStatus,
  IssuePriority,
  RoleTemplate,
  RoleDetail,
  OrgPlan,
  ApplyOrgPlanResult,
  ActivityEventRow,
  ActivityQueryParams,
  CostsQueryInput,
  CostsQueryResult,
  CostsAggregateTodayResult,
  CostBudgets,
  Goal,
  GoalStatus,
  GoalWithPlan,
  CreateGoalInput,
  ExecutePlanResult,
  Skill,
  Memory,
  SessionSearchHit,
  SkillCandidate,
  AgentRunRow,
  AgentBudgetStatus,
  CreateCriterionInput,
  CriterionStatus,
  GoalCriterion,
  IsaDraft,
  UpdateCriterionInput,
  TelosInterviewAnswers,
  TelosDraft,
  ZoneSummary,
  TrustEvent,
  TierEvaluation,
  Briefing,
  Routine,
  UpdaterStatus,
  Attachment,
} from "@prospero/shared";

declare global {
  interface Window {
    prospero: {
      ping: () => Promise<string>;
      settings: {
        get: () => Promise<AppSettings>;
        update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
        pickWorkspace: () => Promise<string | null>;
        getExecutorMode: () => Promise<"atomic" | "narrated">;
        setExecutorMode: (mode: "atomic" | "narrated") => Promise<{ ok: true }>;
      };
      auth: {
        status: () => Promise<TokenStatus>;
        set: (raw: string, source: TokenSource) => Promise<TokenStatus>;
        detect: () => Promise<DetectResult>;
        importDetected: () => Promise<TokenStatus>;
        clear: () => Promise<TokenStatus>;
        apiKeyStatus: () => Promise<ApiKeyStatus>;
        apiKeySet: (raw: string) => Promise<ApiKeyStatus>;
        apiKeyClear: () => Promise<ApiKeyStatus>;
        reconnectRunningAgents: () => Promise<RecoveryResult[]>;
        onRecoveryStatus: (cb: (event: RecoveryStatusEvent) => void) => () => void;
      };
      companies: {
        list: () => Promise<Company[]>;
        createDemo: () => Promise<Company>;
        create: (name: string) => Promise<Company>;
        createOnboarding: (name: string, description?: string) => Promise<Company>;
        delete: (id: string) => Promise<{ ok: true }>;
        exportSnapshot: (id: string) => Promise<unknown>;
        importSnapshot: (snapshot: unknown) => Promise<{
          newCompanyId: string;
          newCompanyName: string;
          counts: Record<string, number>;
          goalIdMap: Record<string, string>;
          warnings: string[];
        }>;
      };
      agentsMd: {
        parse: (raw: string) => Promise<
          | {
              ok: true;
              data: {
                company: string;
                projects: { name: string; path: string }[];
                roles?: {
                  name: string;
                  description?: string;
                  model?: string;
                  capabilities?: string[];
                  icon?: string;
                  charter?: string;
                }[];
                agents: {
                  name: string;
                  role: string;
                  model?: string;
                  capabilities?: string[];
                  reports_to?: string;
                  projects?: string[];
                }[];
              };
            }
          | { ok: false; error: string }
        >;
        hire: (
          companyId: string,
          payload: unknown,
          conflictModes: Record<string, "skip" | "replace">,
        ) => Promise<{
          companyId: string;
          created: { projects: number; roles: number; agents: number };
          skipped: { projects: string[]; roles: string[]; agents: string[] };
          replaced: { agents: string[] };
          warnings: string[];
        }>;
        export: (companyId: string) => Promise<{ text: string }>;
      };
      agents: {
        list: (companyId: string) => Promise<Agent[]>;
        sendMessage: (agentId: string, content: string) => Promise<Message>;
        kill: (agentId: string) => Promise<void>;
        setAllowedProjects: (agentId: string, projectIds: string[]) => Promise<void>;
        setModel: (agentId: string, model: string) => Promise<{ ok: true }>;
        setRole: (
          agentId: string,
          roleTemplateId: string,
          opts?: { preserveModel?: boolean },
        ) => Promise<{ ok: true }>;
        setSystemPrompt: (agentId: string, systemPrompt: string) => Promise<{ ok: true }>;
        setReportsTo: (agentId: string, reportsTo: string | null) => Promise<{ ok: true }>;
        setAdapter: (agentId: string, adapterName: string) => Promise<{ ok: true }>;
        stats: (agentId: string) => Promise<AgentStats>;
        setMode: (agentId: string, mode: "supervised" | "auto") => Promise<{ ok: true }>;
        setAlwaysOn: (agentId: string, alwaysOn: boolean) => Promise<{ ok: true }>;
        setCapabilities: (agentId: string, capabilities: string[]) => Promise<{ ok: true }>;
        setBudget: (
          agentId: string,
          tokensLimit: number | null,
          usdLimit: number | null,
          period: "daily" | "monthly",
        ) => Promise<{ ok: true }>;
        setPermissions: (
          agentId: string,
          canHire: boolean,
          canAssign: boolean,
        ) => Promise<{ ok: true }>;
        pause: (agentId: string, reason?: string) => Promise<{ ok: true }>;
        resume: (agentId: string) => Promise<{ ok: true; drained: number }>;
        terminate: (agentId: string, reason?: string) => Promise<{ ok: true }>;
        wakeUp: (agentId: string) => Promise<{ ok: true }>;
        resetSession: (agentId: string) => Promise<{ ok: true }>;
        hireFromUi: (payload: {
          company_id: string;
          name: string;
          role: string;
          system_prompt: string;
          mode?: "supervised" | "auto";
          reports_to?: string;
          role_template_id?: string;
          location?: "local" | "remote";
        }) => Promise<Agent>;
        onEvent: (cb: (event: AgentEvent) => void) => () => void;
      };
      messages: {
        list: (companyId: string, participants: string[]) => Promise<Message[]>;
        listByAgent: (agentId: string) => Promise<Message[]>;
      };
      attachments: {
        upload: (input: {
          buffer: ArrayBuffer;
          filename: string;
          mimeType: string;
        }) => Promise<Attachment>;
        delete: (id: string) => Promise<void>;
        open: (id: string) => Promise<{ ok: true } | { error: string }>;
      };
      inbox: {
        list: (companyId: string) => Promise<InboxItem[]>;
        markRead: (id: string) => Promise<void>;
        onUpdate: (cb: () => void) => () => void;
      };
      permissions: {
        resolve: (toolUseId: string, resolution: PermissionResolution) => Promise<void>;
        onRequest: (cb: (req: PermissionRequest) => void) => () => void;
      };
      projects: {
        list: (companyId: string) => Promise<Project[]>;
        create: (input: {
          companyId: string;
          name: string;
          path: string;
          color: string;
        }) => Promise<Project>;
        update: (input: {
          id: string;
          name?: string;
          path?: string;
          color?: string;
        }) => Promise<Project | null>;
        delete: (id: string) => Promise<{ ok: true }>;
        openFolder: (id: string) => Promise<{ opened: boolean }>;
        checkPaths: (companyId: string) => Promise<Record<string, ProjectPathStatus>>;
        setIcon: (id: string, icon: string | null) => Promise<{ ok: true }>;
        archive: (id: string) => Promise<{ ok: true }>;
        unarchive: (id: string) => Promise<{ ok: true }>;
      };
      issues: {
        list: (payload: {
          companyId: string;
          projectId?: string;
          assigneeId?: string;
          status?: IssueStatus;
        }) => Promise<Issue[]>;
        get: (id: string) => Promise<IssueDetail | null>;
        create: (input: {
          companyId: string;
          projectId: string | null;
          title: string;
          description?: string | null;
          assigneeId?: string | null;
          priority?: IssuePriority;
          parentId?: string | null;
        }) => Promise<Issue>;
        update: (input: {
          id: string;
          title?: string;
          description?: string | null;
          status?: IssueStatus;
          assigneeId?: string | null;
          priority?: IssuePriority;
          parentId?: string | null;
        }) => Promise<Issue | null>;
        delete: (id: string) => Promise<{ ok: true }>;
        addComment: (issueId: string, content: string) => Promise<IssueComment>;
        listArtifacts: (issueId: string) => Promise<IssueArtifact[]>;
        onChanged: (
          cb: (event: { kind: string; issueId: string; companyId: string }) => void,
        ) => () => void;
      };
      roles: {
        list: () => Promise<Array<RoleTemplate & { agentCount: number }>>;
        get: (id: string) => Promise<RoleDetail | null>;
        create: (input: {
          name: string;
          description: string;
          icon: string | null;
          defaultModel: string;
          defaultCapabilities: string[];
        }) => Promise<RoleTemplate>;
        update: (input: {
          id: string;
          name?: string;
          description?: string;
          icon?: string | null;
          defaultModel?: string;
          defaultCapabilities?: string[];
        }) => Promise<RoleTemplate>;
        delete: (id: string) => Promise<{ ok: true }>;
        clone: (id: string) => Promise<RoleTemplate>;
        getCharter: (id: string) => Promise<{ body: string }>;
        saveCharter: (id: string, body: string) => Promise<{ ok: true }>;
        generateCharter: (description: string) => Promise<{ charter: string }>;
      };
      instructions: {
        list: (agentId: string) => Promise<{
          files: Array<{ filename: string; isEntry: boolean }>;
        }>;
        read: (agentId: string, filename: string) => Promise<{ body: string }>;
        write: (agentId: string, filename: string, body: string) => Promise<{ ok: true }>;
        add: (agentId: string, filename: string) => Promise<{ ok: true }>;
        delete: (agentId: string, filename: string) => Promise<{ ok: true }>;
      };
      orgPlan: {
        getCurrent: () => Promise<OrgPlan | null>;
        approve: (input: {
          orgPlanId: string;
          includeRoleIndexes?: number[];
          includeAgentIndexes?: number[];
        }) => Promise<ApplyOrgPlanResult>;
        reject: (input: { orgPlanId: string; reason?: string }) => Promise<{ ok: true }>;
      };
      activity: {
        query: (params: ActivityQueryParams) => Promise<ActivityEventRow[]>;
        onNew: (cb: (row: ActivityEventRow) => void) => () => void;
      };
      costs: {
        query: (input: CostsQueryInput) => Promise<CostsQueryResult>;
        aggregateToday: (payload: { companyId: string }) => Promise<CostsAggregateTodayResult>;
        getBudgets: () => Promise<CostBudgets>;
        setBudgets: (patch: Partial<CostBudgets>) => Promise<CostBudgets>;
        getAgentBudgetStatus: (agentId: string) => Promise<AgentBudgetStatus>;
        onNew: (
          cb: (payload: { agentId: string; deltaTokens: number; deltaCents: number }) => void,
        ) => () => void;
      };
      runs: {
        list: (agentId: string, limit?: number) => Promise<AgentRunRow[]>;
      };
      goals: {
        list: (args: { companyId: string; status?: GoalStatus }) => Promise<Goal[]>;
        get: (args: { id: string }) => Promise<GoalWithPlan>;
        create: (args: CreateGoalInput) => Promise<Goal>;
        requestPlan: (args: { goalId: string }) => Promise<{ ok: true }>;
        approvePlan: (args: {
          planId: string;
          includeAgentIndexes?: number[];
          includeIssueIndexes?: number[];
          mode?: "atomic" | "narrated";
        }) => Promise<ExecutePlanResult>;
        requestChanges: (args: { planId: string; feedback: string }) => Promise<{ ok: true }>;
        rejectPlan: (args: { planId: string; reason?: string }) => Promise<{ ok: true }>;
        narratedResume: (args: { goalId: string }) => Promise<{ ok: true }>;
        narratedRollback: (args: { goalId: string }) => Promise<{ aborted: true }>;
      };
      isa: {
        get: (args: { goalId: string }) => Promise<{ body: string; criteria: GoalCriterion[] }>;
        save: (args: { goalId: string; body: string }) => Promise<void>;
        generate: (args: { goalId: string }) => Promise<IsaDraft>;
        criterionCreate: (args: CreateCriterionInput) => Promise<GoalCriterion>;
        criterionUpdate: (args: {
          id: string;
          patch: UpdateCriterionInput;
        }) => Promise<GoalCriterion>;
        criterionDelete: (args: { id: string }) => Promise<void>;
        criterionJudge: (args: { criterionId: string; verdict: CriterionStatus }) => Promise<void>;
      };
      telos: {
        get: (args: { companyId: string }) => Promise<{ body: string | null }>;
        save: (args: { companyId: string; body: string }) => Promise<void>;
        synthesize: (args: {
          companyId: string;
          answers: TelosInterviewAnswers;
        }) => Promise<TelosDraft>;
      };
      security: {
        listZones: () => Promise<ZoneSummary[]>;
      };
      trust: {
        getHistory: (args: { agentId: string }) => Promise<TrustEvent[]>;
        approvePromotion: (args: { inboxItemId: string }) => Promise<{ ok: true }>;
        getEvaluation: (args: { agentId: string }) => Promise<TierEvaluation>;
      };
      briefing: {
        get: (args: { companyId: string }) => Promise<Briefing>;
        markReviewed: (args: { companyId: string }) => Promise<void>;
      };
      routines: {
        list: (args: { companyId: string }) => Promise<Routine[]>;
        create: (args: { input: unknown }) => Promise<Routine>;
        update: (args: { input: unknown }) => Promise<Routine>;
        delete: (args: { id: string }) => Promise<{ ok: true }>;
        runNow: (args: { id: string }) => Promise<{ ok: true }>;
      };
      managerRequest: {
        decide: (
          approvalId: string,
          decision: "approved" | "rejected",
          note?: string,
        ) => Promise<void>;
      };
      updater: {
        checkNow: () => Promise<void>;
        status: () => Promise<UpdaterStatus>;
        installNow: () => Promise<void>;
        onEvent: (cb: (status: UpdaterStatus) => void) => () => void;
      };
      remote: {
        testConnection: () => Promise<{ ok: boolean; message: string }>;
      };
      learning: {
        listSkills: (agentId: string) => Promise<Skill[]>;
        readSkillBody: (skillId: string) => Promise<{ body: string }>;
        listMemories: (agentId: string) => Promise<Memory[]>;
        searchSessions: (
          agentId: string,
          query: string,
          limit?: number,
        ) => Promise<SessionSearchHit[]>;
        listCandidates: (agentId: string) => Promise<SkillCandidate[]>;
        acceptCandidate: (input: {
          candidateId: string;
          name?: string;
          description?: string;
          body?: string;
        }) => Promise<Skill>;
        rejectCandidate: (input: { candidateId: string; reason?: string }) => Promise<{
          ok: true;
        }>;
        approveSkillPromotion: (input: {
          skillId: string;
          appliesToRole: string | null;
        }) => Promise<Skill>;
        orgLearnings: (companyId: string) => Promise<{
          topSkills: Skill[];
          recentRetrospectives: Memory[];
        }>;
        rateSkill: (skillId: string, direction: "up" | "down") => Promise<Skill>;
        rateMemory: (memoryId: string, direction: "up" | "down") => Promise<Memory>;
        getUserMemory: () => Promise<{ content: string }>;
        setUserMemory: (content: string) => Promise<{ ok: true }>;
        importClaudeCodeMemory: () => Promise<{ content: string }>;
        promoteSkillsOnTerminate: (
          agentId: string,
          promoteSkillIds: string[],
        ) => Promise<{ promoted: number; softDeleted: number }>;
      };
      windowControls: {
        minimize: () => Promise<void>;
        maximizeToggle: () => Promise<void>;
        close: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
        onStateChanged: (cb: (state: { isMaximized: boolean }) => void) => () => void;
      };
    };
  }
}
export {};
