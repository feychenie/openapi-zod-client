import { editor } from "monaco-editor";
import { getHandlebars, getZodClientTemplateContext, maybePretty, TemplateContext } from "openapi-zod-client";
import { assign, createMachine, InterpreterFrom } from "xstate";
import { Options as PrettierOptions } from "prettier";
import { ResizablePanesContext } from "../components/SplitPane/SplitPane.machine";
import {
    AwaitFn,
    capitalize,
    createContextWithHook,
    limit,
    pick,
    removeAtIndex,
    safeJSONParse,
    updateAtIndex,
} from "pastable";
import { defaultOptionValues, OptionsFormValues } from "../components/OptionsForm";
import { presets } from "./presets";
import { parse } from "yaml";
import { match } from "ts-pattern";
import { PresetTemplate, presetTemplateList } from "./Playground.consts";
import type { Monaco } from "@monaco-editor/react";

export type FileTabData = { name: string; content: string; index: number; preset?: string };

type PlaygroundContext = {
    monaco: Monaco | null;
    inputEditor: editor.IStandaloneCodeEditor | null;
    outputEditor: editor.IStandaloneCodeEditor | null;

    options: OptionsFormValues;
    previewOptions: OptionsFormValues;
    optionsFormKey: number;

    activeInputTab: string;
    activeInputIndex: number;
    inputList: FileTabData[];

    activeOutputTab: string;
    activeOutputIndex: number;
    outputList: FileTabData[];

    selectedOpenApiFileName: string;
    selectedTemplateName: string;
    selectedPrettierConfig: string;

    templateContext: TemplateContext | null;
    presetTemplates: Record<string, string>;

    fileForm: FileTabData;
};

type PlaygroundEvent =
    | { type: "Editor Loaded"; editor: editor.IStandaloneCodeEditor; name: "input" | "output"; monaco?: Monaco }
    | { type: "Update input"; value: string }
    | { type: "Select input tab"; tab: FileTabData }
    | { type: "Select output tab"; tab: FileTabData }
    | { type: "Select preset template"; template: PresetTemplate }
    | { type: "Open options" }
    | { type: "Close options" }
    | { type: "Open monaco settings" }
    | { type: "Add file" }
    | { type: "Edit file"; tab: FileTabData }
    | { type: "Remove file"; tab: FileTabData }
    | { type: "Save" }
    | { type: "Share" }
    | { type: "Update preview options"; options: OptionsFormValues }
    | { type: "Reset preview options" }
    | { type: "Save options"; options: OptionsFormValues }
    | { type: "Update monaco settings" }
    | { type: "Submit file modal"; tab: FileTabData }
    | { type: "Close modal" }
    | { type: "Resize"; context: ResizablePanesContext };

const initialInputList = [
    { name: "api.doc.yaml", content: presets.defaultInput, index: 0, preset: "petstore.yaml" },
    { name: "template.hbs", content: presets.defaultTemplate, index: 1, preset: presetTemplateList[0].value },
    {
        name: ".prettierrc.json",
        content: JSON.stringify(presets.defaultPrettierConfig, null, 4),
        index: 2,
        preset: "prettier",
    },
] as const; // TODO as FileTabData[] with ts 4.9 satisfies
const initialOuputTab = "api.client.ts";

const isValidDocumentName = (name: string) =>
    !isValidPrettierConfig(name) && (name.endsWith(".yml") || name.endsWith(".yaml") || name.endsWith(".json"));

const isValidTemplateName = (name: string) => name.endsWith(".hbs");
const isValidPrettierConfig = (name: string) => name.startsWith(".prettier") && name.endsWith(".json");

export const playgroundMachine =
    /** @xstate-layout N4IgpgJg5mDOIC5QAcA2BDAnlATgewFcA7CAOlT3QgEsioBiAURoBc8cACAGUokgG0ADAF1EKPLGotqeImJAAPRAFoAHAEYAbKQDsAJgAsmzQFYAnJoDMJweYA0ITIgNmDpA4L0bXqgzvM6lgC+QQ5oWLiEJOS8tAzMUuzcvALqokggyBJSMnIZSgjK6oKqZqRm6qomqt4Glv4GDk4IJnrqulV6gSVaqpp6IWEY2PjEZDhgVJikAArDcfQQsmCktABueADWK+EjUeOTENNzWHEI63gAxujSskLC9-JZkrd5oAWWtrpdJi46FZZLHpLJomoh1OoTCZSKodH0DCZPrD-ppBplhpExqQJlNZvM6PQAKrICA3MAcWjIAgsR4ZZ45WTyArqAyqUiCdR6aqCEFeYzAsEIdRA9rAvQcnn6CF+NG7THRHFHPGnAkAZTAqDAlxYFKIVJ1LHQACNaeIXrkmYh6to+hUEZYzDoWTVBWYLLodJpBGYanorP1ZRjRgrDsd8Qx1Zrtbr9RxDSa0k9sq9LQhPYJSF4LBDfiZ-FZXe6dJ7Of8kYJNKpAxFgwdcSdMAtI1qdYQWLH46bMsmLflwao9LooWYTF6vII-KDHIg3Wz9F1-izXMZgqF0TX9tjQ8rG2qNS2OMgJrAwAawABbcIsMBd+kpvsITSs9kGAyGTT+VTe36CzmuGFwsWbrqMWIGrkMG5YoqYYqgwADyyBgEQHB4MgrywLePaMg+RQeOyno6AipjqG6-y-lY7SCJ4Bi9CUCKOtWexQduDYLAhSGHhMLDSGAnCXLIABm1BQJh5rYe8KggWUtimC44p5pyPK-vUg6fE6lYgoIxYmIx8p1kqrEEuxyHnrI6D8RwJ7cXEGEiEmYlvIokmwqQ-SVn4rQ+rCPq-lUZRZqolh+FoE48rptZbvW4b0AAghAEAcEJmqiQyjkFMohgZnoFQlBoJGBJ6v48myDrAkCFhupYLLhZu0E7gsCQ6klN52XSWFpSo-iWDCjq8kBEKuK6b74V0X7GKUfTqDVzFRbB9AAEoXngazks1KX3hJCBVdCrLCl+u1+o005CoC0JmJ4gJwhoXokdNIa4o1cQoWhuSwESJJkpxYBrNQYAAO7Peh629ptyiVtoxbBR+1gFeov4BK5Zg-EF5iOgYd36dMj10IDr0LXAp5fT9-247ItnpGaqWpsol3slp2XbV4xY6PDLKkK0eicyBdS+joGORUq2NQKTRBvaq6ArSL5P2VTOF+IOnJaP02VPpolRTs0IGmOynwcl4rSApU-N1ULUv0AAwhQJ5S8D4lOYUXhuJYVQroBzomL+hE6OzEKwhy13GOja5yhFJusE9R6njxfGCcJ72kteX3WbxHD8UQQkia1lMbfbYMIu4NEaYbQKWMpz4aDUJick+LITsb26m5Hycx+nceWxI5KmaSqC2x1hTO2UIIaFRo5vsPGvgq+0nnSCSNVzyo71w94c46ZRDmXgllRzZFtW53eDd731M0d1bRlVo-x8j+x0kTYrleEFskkaRS+CyvwvNXGxr0KqBBGueUhErUE1BwLu6Ae5Z27A5amxQBzlH8DYKuvtCKCkCG4KocIfDeTqAMYOQZaoN3fkAkB8Zd4d1AQfcBR8cKIm9k6cUJQvR5kdCzY6A42RM2qFCD8sJISv2mObHE0gcaf1Ib-f+gDP5gIgRTKBstQYuDKMKT0XpKwVF8CyV0WhSDCjqFXN0OUgr8NIIIyYwiP7APJKQ9u1tpHUNBlyGEthKh+kXJ8KqroPzszdOKHQWlXxaQxvjSQAAvFqsi7wg1ztmXQlY2iaDMECAcE8EBcnaAkx0xQ2i5hcKiNERAD5wCePgrEFAqBxBljndKEJKgdGok6JGH4jrNDqN1Ec2U-F1D+CyPJEEmL3QMuGSpUSCg1FICCYwcJxQeAdEYX80zyhBU+Nlb0mTenrn6ZjUgptULoWGXbdKHhoQkU+LJQKgRKjkTaDo4eDoahLL6MYxuXFo6p1jlAfZfdlBvkHFCXoVdRz6BKB7G+KlxlaWKH4lkej1khwIcvHIq8zIWSsuY+AbVoFy1KK5fQQIaJaBBJCEFms+glTFLCU6XQzBPKIaI40nzqaESyrip0HkeTO0FIFaETDfhwnMDUWExjTE3CenSo0DKcKGDcCySEVEKzO2sJ472qNgSQ38Co-hErQYQk+PAqEzjkHNMQE+aEGDShPg5COT0GMtW5whHCPViCamwiNVtV85RPJ9BsIpAcIQQhAA */
    createMachine(
        {
            predictableActionArguments: true,
            id: "playground",
            tsTypes: {} as import("./Playground.machine.typegen").Typegen0,
            schema: {
                context: {} as PlaygroundContext,
                events: {} as PlaygroundEvent,
            },
            context: {
                monaco: null,
                inputEditor: null,
                outputEditor: null,
                options: defaultOptionValues,
                previewOptions: defaultOptionValues,
                optionsFormKey: 0,
                templateContext: null,
                activeInputTab: initialInputList[0].name,
                activeInputIndex: 0,
                inputList: initialInputList as any as FileTabData[], // TODO rm with ts 4.9 satisfies
                selectedOpenApiFileName: initialInputList[0].name,
                selectedTemplateName: initialInputList[1].name,
                selectedPrettierConfig: initialInputList[2].name,
                presetTemplates: {},
                activeOutputTab: initialOuputTab,
                activeOutputIndex: 0,
                outputList: [{ name: initialOuputTab, content: "", index: 0 }],
                fileForm: { name: "", content: "", index: -1 },
            },
            initial: "loading",
            states: {
                loading: {
                    on: {
                        "Editor Loaded": [
                            {
                                target: "ready",
                                actions: ["assignEditorRef", "updateOutput"],
                                cond: "willInputAndOutputEditorBothBeReady",
                            },
                            {
                                actions: "assignEditorRef",
                            },
                        ],
                    },
                },
                ready: {
                    initial: "Playing",
                    states: {
                        Playing: {
                            on: {
                                "Update input": [
                                    {
                                        actions: ["updateInput", "updateOutput", "updateSelectedDocOrTemplate"],
                                        cond: "wasInputEmpty",
                                    },
                                    { actions: ["updateInput", "updateOutput"] },
                                ],
                                "Select input tab": [
                                    {
                                        actions: ["selectInputTab", "updateSelectedOpenApiFileName", "updateOutput"],
                                        cond: "isNextTabAnotherOpenApiDoc",
                                    },
                                    {
                                        actions: ["selectInputTab", "updateSelectedTemplateName", "updateOutput"],
                                        cond: "isNextTabAnotherTemplate",
                                    },
                                    {
                                        actions: ["selectInputTab", "updateSelectedPrettierConfig", "updateOutput"],
                                        cond: "isNextTabAnotherPrettierConfig",
                                    },
                                    { actions: ["selectInputTab"] },
                                ],
                                "Select output tab": { actions: "selectOutputTab" },
                                "Select preset template": { actions: ["selectPresetTemplate", "updateOutput"] },
                                "Open options": { target: "Editing options" },
                                "Open monaco settings": { target: "Editing monaco settings" },
                                "Add file": { target: "Creating file tab", actions: "initFileForm" },
                                "Edit file": { target: "Editing file tab", actions: "assignFileToForm" },
                                "Remove file": {
                                    actions: [
                                        "removeFile",
                                        "updateSelectedOpenApiFileName",
                                        "updateSelectedTemplateName",
                                        "updateSelectedPrettierConfig",
                                        "updateOutput",
                                    ],
                                },
                                // TODO
                                // Save: { actions: "save" },
                                // Share: { actions: ["save", "copyUrlToClipboard"] },
                            },
                            invoke: {
                                id: "getPresetTemplates",
                                src: async () => presets.getTemplates(),
                                onDone: {
                                    actions: assign({
                                        presetTemplates: (_ctx: any, event) => {
                                            return event.data as AwaitFn<typeof presets.getTemplates>;
                                        },
                                    }),
                                },
                            },
                        },
                        "Editing options": {
                            on: {
                                "Update preview options": { actions: "updatePreviewOptions" },
                                "Reset preview options": { actions: "resetPreviewOptions" },
                                "Save options": { target: "Playing", actions: ["updateOptions", "updateOutput"] },
                                "Close options": { target: "Playing" },
                            },
                        },
                        "Editing monaco settings": {
                            on: {
                                // TODO
                                // "Update monaco settings": { actions: "updateMonacoSettings" },
                                "Close modal": { target: "Playing" },
                            },
                        },
                        "Editing file tab": {
                            tags: ["file"],
                            on: {
                                "Submit file modal": {
                                    target: "Playing",
                                    actions: [
                                        "updateEditingFile",
                                        "selectInputTab",
                                        "updateInputEditorValue",
                                        "updateSelectedOpenApiFileName",
                                        "updateSelectedTemplateName",
                                        "updateSelectedPrettierConfig",
                                        "updateOutput",
                                    ],
                                },
                                "Close modal": { target: "Playing" },
                            },
                        },
                        "Creating file tab": {
                            tags: ["file"],
                            on: {
                                "Submit file modal": {
                                    target: "Playing",
                                    actions: [
                                        "createNewFile",
                                        "selectInputTab",
                                        "updateInputEditorValue",
                                        "updateSelectedOpenApiFileName",
                                        "updateSelectedTemplateName",
                                        "updateSelectedPrettierConfig",
                                        "updateOutput",
                                    ],
                                },
                                "Close modal": { target: "Playing" },
                            },
                        },
                    },
                },
            },
            on: {
                Resize: { actions: "resize" },
            },
        },
        {
            actions: {
                assignEditorRef: assign((ctx, event) => {
                    if (event.name === "input") {
                        return { ...ctx, inputEditor: event.editor };
                    }

                    return { ...ctx, outputEditor: event.editor, monaco: event.monaco };
                }),
                updateInputEditorValue: (ctx) => {
                    if (!ctx.inputEditor) return;
                    ctx.inputEditor.setValue(ctx.inputList[ctx.activeInputIndex].content);
                },
                updateInput: assign({
                    inputList: (ctx, event) => {
                        const activeIndex = ctx.activeInputIndex;
                        return updateAtIndex(ctx.inputList, activeIndex, {
                            ...ctx.inputList[activeIndex],
                            content: event.value,
                        });
                    },
                }),
                updateOutput: assign((ctx, event) => {
                    let input;
                    const documentIndex = ctx.inputList.findIndex((item) => item.name === ctx.selectedOpenApiFileName);
                    input = ctx.inputList[documentIndex]?.content ?? "";

                    if (event.type === "Submit file modal") {
                        input = event.tab.content;
                    }

                    if (!input) {
                        return ctx;
                    }

                    const openApiDoc = input.startsWith("{") ? safeJSONParse(input) : parse(input);
                    if (!openApiDoc) return ctx;

                    const options = ctx.options;
                    const templateContext = getZodClientTemplateContext(openApiDoc, options);
                    // logs the template context to the browser console so users can explore it
                    if (typeof window !== "undefined") {
                        console.log({ templateContext, options, openApiDoc });
                    }

                    const hbs = getHandlebars();
                    const templateTab = ctx.inputList.find((item) => item.name === ctx.selectedTemplateName);

                    const templateString =
                        ctx.presetTemplates[
                            presetTemplateList.find((preset) => preset.value === ctx.selectedTemplateName)?.template ??
                                ""
                        ] ??
                        templateTab?.content ??
                        "";

                    if (!templateString) return ctx;
                    const template = hbs.compile(templateString);
                    const prettierConfig = safeJSONParse<PrettierOptions>(
                        ctx.inputList.find((tab) => tab.name === ctx.selectedPrettierConfig)?.content ?? "{}"
                    );

                    // adapted from lib/src/generateZodClientFromOpenAPI.ts:60-120
                    if (options.groupStrategy.includes("file")) {
                        const outputByGroupName: Record<string, string> = {};

                        const groupNames = Object.fromEntries(
                            Object.keys(templateContext.endpointsGroups).map((groupName) => [
                                `${capitalize(groupName)}Api`,
                                groupName,
                            ])
                        );

                        const indexTemplate = hbs.compile(ctx.presetTemplates["template-grouped-index"]);
                        const indexOutput = maybePretty(indexTemplate({ groupNames }), prettierConfig);
                        outputByGroupName.index = indexOutput;

                        const commonTemplate = hbs.compile(ctx.presetTemplates["template-grouped-common"]);
                        const commonSchemaNames = [...(templateContext.commonSchemaNames ?? [])];

                        if (commonSchemaNames.length > 0) {
                            const commonOutput = maybePretty(
                                commonTemplate({
                                    schemas: pick(templateContext.schemas, commonSchemaNames),
                                    types: pick(templateContext.types, commonSchemaNames),
                                }),
                                prettierConfig
                            );
                            outputByGroupName.common = commonOutput;
                        }

                        for (const groupName in templateContext.endpointsGroups) {
                            const groupOutput = template({
                                ...templateContext,
                                ...templateContext.endpointsGroups[groupName],
                                options: {
                                    ...options,
                                    groupStrategy: "none",
                                    apiClientName: `${capitalize(groupName)}Api`,
                                },
                            });
                            outputByGroupName[groupName] = maybePretty(groupOutput, prettierConfig);
                        }

                        const outputList = Object.entries(outputByGroupName).map(([name, content], index) => ({
                            name: name + ".ts",
                            content,
                            index,
                        })) as FileTabData[];

                        const monaco = ctx.monaco;
                        if (monaco) {
                            outputList.forEach((tab) => {
                                const uri = new monaco.Uri().with({ path: tab.name });
                                if (!monaco.editor.getModel(uri)) {
                                    monaco.editor.createModel(tab.content, "typescript", uri);
                                }
                            });
                        }

                        if (ctx.outputEditor) {
                            ctx.outputEditor.setValue(outputList[0].content);
                        }

                        return {
                            ...ctx,
                            outputList,
                            activeOutputIndex: 0,
                            activeOutputTab: outputList[0].name,
                        };
                    }

                    const output = template({ ...templateContext, options });
                    const prettyOutput = maybePretty(output, prettierConfig);

                    if (ctx.outputEditor) {
                        ctx.outputEditor.setValue(prettyOutput);
                    }

                    return {
                        ...ctx,
                        templateContext,
                        outputList: [{ name: initialOuputTab, content: prettyOutput, index: 0 }],
                    };
                }),
                selectInputTab: assign({
                    activeInputTab: (_ctx, event) => event.tab.name,
                    activeInputIndex: (ctx, event) => ctx.inputList.findIndex((tab) => tab.name === event.tab.name),
                }),
                updateSelectedOpenApiFileName: assign({
                    selectedOpenApiFileName: (ctx, event) => {
                        if (event.type === "Remove file") {
                            const nextIndex = ctx.inputList.findIndex((tab) => isValidDocumentName(tab.name));
                            return nextIndex === -1 ? ctx.selectedOpenApiFileName : ctx.inputList[nextIndex].name;
                        }

                        if (!event.tab.content) return ctx.selectedOpenApiFileName;

                        const nextIndex = ctx.inputList.findIndex((tab) => tab.name === event.tab.name);
                        if (nextIndex === -1) return ctx.selectedOpenApiFileName;

                        return isValidDocumentName(ctx.inputList[nextIndex].name)
                            ? event.tab.name
                            : ctx.inputList.find((tab) => isValidDocumentName(tab.name))?.name ?? "";
                    },
                }),
                updateSelectedTemplateName: assign({
                    selectedTemplateName: (ctx, event) => {
                        if (event.type === "Remove file") {
                            const nextIndex = ctx.inputList.findIndex((tab) => isValidTemplateName(tab.name));
                            return nextIndex === -1 ? ctx.selectedTemplateName : ctx.inputList[nextIndex].name;
                        }

                        if (!event.tab.content) return ctx.selectedTemplateName;

                        const nextIndex = ctx.inputList.findIndex((tab) => tab.name === event.tab.name);
                        if (nextIndex === -1) return ctx.selectedTemplateName;

                        return isValidTemplateName(ctx.inputList[nextIndex].name)
                            ? event.tab.name
                            : ctx.selectedTemplateName;
                    },
                }),
                updateSelectedPrettierConfig: assign({
                    selectedPrettierConfig: (ctx, event) => {
                        if (event.type === "Remove file") {
                            const nextIndex = ctx.inputList.findIndex((tab) => isValidPrettierConfig(tab.name));
                            return nextIndex === -1 ? ctx.selectedPrettierConfig : ctx.inputList[nextIndex].name;
                        }

                        if (!event.tab.content) return ctx.selectedPrettierConfig;

                        const nextIndex = ctx.inputList.findIndex((tab) => tab.name === event.tab.name);
                        if (nextIndex === -1) return ctx.selectedPrettierConfig;

                        return isValidPrettierConfig(ctx.inputList[nextIndex].name)
                            ? event.tab.name
                            : ctx.selectedPrettierConfig;
                    },
                }),
                updateSelectedDocOrTemplate: assign((ctx, event) => {
                    const tab = ctx.inputList[ctx.activeInputIndex];

                    return {
                        ...ctx,
                        selectedOpenApiFileName: isValidDocumentName(tab.name) ? tab.name : ctx.selectedOpenApiFileName,
                        selectedTemplateName: isValidTemplateName(tab.name) ? tab.name : ctx.selectedTemplateName,
                    };
                }),
                selectOutputTab: assign({
                    activeOutputTab: (_ctx, event) => event.tab.name,
                    activeOutputIndex: (ctx, event) => ctx.outputList.findIndex((tab) => tab.name === event.tab.name),
                }),
                selectPresetTemplate: assign({
                    selectedTemplateName: (_ctx, event) => event.template.value,
                    inputList: (ctx, event) => {
                        const content = ctx.presetTemplates[event.template.template];
                        if (!content) return ctx.inputList;

                        const presetTemplateIndex = ctx.inputList.findIndex(
                            (tab) => tab.preset && isValidTemplateName(tab.name)
                        );
                        if (presetTemplateIndex === -1) return ctx.inputList;

                        return updateAtIndex(ctx.inputList, presetTemplateIndex, {
                            ...ctx.inputList[presetTemplateIndex],
                            content,
                            preset: event.template.value,
                        });
                    },
                    options: (ctx, event) => {
                        if (!event.template.options) return ctx.options;

                        return { ...ctx.options, ...event.template.options };
                    },
                }),
                initFileForm: assign({
                    fileForm: (ctx) => ({ name: "", content: "", index: ctx.inputList.length }),
                }),
                assignFileToForm: assign({ fileForm: (_ctx, event) => event.tab }),
                removeFile: assign((ctx, event) => {
                    const index = event.tab.index;
                    const next = removeAtIndex(ctx.inputList, index);
                    const isCurrentActive = ctx.activeInputIndex === index;
                    if (!isCurrentActive) {
                        return { ...ctx, inputList: next };
                    }

                    const nextIndex = limit(index, [0, next.length - 1]);

                    return {
                        ...ctx,
                        inputList: next,
                        activeInputTab: next[nextIndex].name,
                        activeInputIndex: nextIndex,
                    };
                }),
                updatePreviewOptions: assign({ previewOptions: (_ctx, event) => event.options }),
                resetPreviewOptions: assign({
                    previewOptions: (_ctx) => defaultOptionValues,
                    optionsFormKey: (ctx) => ctx.optionsFormKey + 1,
                }),
                updateOptions: assign({
                    options: (_ctx, event) => event.options,
                    previewOptions: (_ctx, event) => event.options,
                }),
                updateEditingFile: assign({
                    inputList: (ctx, event) => updateAtIndex(ctx.inputList, ctx.fileForm.index, event.tab),
                }),
                createNewFile: assign({
                    inputList: (ctx, event) => [...ctx.inputList, event.tab],
                }),
                resize: (ctx, event) => {
                    if (!ctx.outputEditor) return;
                    ctx.outputEditor.layout({
                        width: event.context.containerSize - event.context.draggedSize,
                        height: ctx.outputEditor.getLayoutInfo().height,
                    });
                },
            },
            guards: {
                willInputAndOutputEditorBothBeReady: (ctx) => Boolean(ctx.inputEditor ?? ctx.outputEditor),
                isNextTabAnotherOpenApiDoc: (ctx, event) => {
                    if (event.tab.name === ctx.selectedOpenApiFileName) return false;

                    const nextIndex = ctx.inputList.findIndex((tab) => tab.name === event.tab.name);
                    return isValidDocumentName(ctx.inputList[nextIndex].name);
                },
                isNextTabAnotherTemplate: (ctx, event) => {
                    if (event.tab.name === ctx.selectedTemplateName) return false;

                    const nextIndex = ctx.inputList.findIndex((tab) => tab.name === event.tab.name);
                    return isValidTemplateName(ctx.inputList[nextIndex].name);
                },
                isNextTabAnotherPrettierConfig: (ctx, event) => {
                    if (event.tab.name === ctx.selectedPrettierConfig) return false;

                    const nextIndex = ctx.inputList.findIndex((tab) => tab.name === event.tab.name);
                    return isValidPrettierConfig(ctx.inputList[nextIndex].name);
                },
                wasInputEmpty: (ctx, event) => {
                    return Boolean(ctx.inputList[ctx.activeInputIndex].content.trim() === "" && event.value);
                },
            },
        }
    );

export const [PlaygroundMachineProvider, usePlaygroundContext] =
    createContextWithHook<InterpreterFrom<typeof playgroundMachine>>("PlaygroundMachineContext");