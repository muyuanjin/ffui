<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Github, Star, Bug, ExternalLink } from "lucide-vue-next";
import {
  FFUI_AUTHOR_HANDLE,
  FFUI_GITHUB_AUTHOR_URL,
  FFUI_GITHUB_NEW_ISSUE_URL,
  FFUI_GITHUB_REPO_URL,
} from "@/constants/community";
import { openExternalUrl } from "@/lib/externalLinks";

const { t } = useI18n();

const openRepo = async () => openExternalUrl(FFUI_GITHUB_REPO_URL);
const reportIssue = async () => openExternalUrl(FFUI_GITHUB_NEW_ISSUE_URL);
const openAuthor = async () => openExternalUrl(FFUI_GITHUB_AUTHOR_URL);
</script>

<template>
  <Card class="border-border/50 bg-card/95 shadow-sm" data-testid="settings-community">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.communityTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent class="p-2 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <Badge variant="secondary" class="h-6 px-2 text-[10px]">
          <Github class="h-3.5 w-3.5" aria-hidden="true" />
          <span>GitHub</span>
          <span class="opacity-60">&nbsp;·&nbsp;</span>
          <button
            type="button"
            class="hover:text-foreground transition-colors"
            data-testid="settings-author-link"
            @click="openAuthor"
          >
            <span class="text-foreground/90">@{{ FFUI_AUTHOR_HANDLE }}</span>
          </button>
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          class="h-6 px-2 text-[10px]"
          data-testid="settings-open-repo"
          @click="openRepo"
        >
          <ExternalLink class="h-3.5 w-3.5 mr-1" aria-hidden="true" />
          {{ t("app.settings.openRepoButton") }}
        </Button>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[10px]"
          data-testid="settings-report-issue"
          @click="reportIssue"
        >
          <Bug class="h-3.5 w-3.5 mr-1" aria-hidden="true" />
          {{ t("app.settings.reportIssueButton") }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[10px]"
          data-testid="settings-star-repo"
          @click="openRepo"
        >
          <Star class="h-3.5 w-3.5 mr-1" aria-hidden="true" />
          {{ t("app.settings.starRepoButton") }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
