import DeleteListModal from "modals/DeleteListModal";
import TagSuggester from "modals/TagSuggester";
import { Plugin, MarkdownView, TFile } from "obsidian";

export interface TagList {
	tag: string;
	notePath: string;
	id: number; // Timestamp when the list was created
}

export default class TagFlowPlugin extends Plugin {
	allTags: string[] = [];
	lists: TagList[] = [];
	tagCache = new Map<string, Set<string>>();
	hasSelectedTag = false;
	tagChanged = false;

	async onload() {
		console.log("Plugin loaded");
		await this.loadData();
		this.allTags = await this.fetchAllTags();

		// this.registerCodeMirror((cm: CodeMirror.Editor) => {
		// 	cm.on("change", this.handleFileChange.bind(this));
		// });

		this.addCommand({
			id: "delete-current-list",
			name: "Delete Current List",
			callback: () => new DeleteListModal(this.app, this).open(),
		});

		this.addCommand({
			id: "open-tag-flow",
			name: "Open Tag Flow",
			callback: () => this.createTagList(),
		});

		this.app.workspace.on("active-leaf-change", () => {
			console.log("active-leaf-change");
			this.updateLists();
		});

		this.app.workspace.on("layout-change", () => {
			if (this.app.workspace.getLeavesOfType("graph").length > 0) {
				console.log("layout-change");
				this.updateLists();
			}
		});

		// Update the cache whenever a file is modified
		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (file instanceof TFile) {
					if (file.basename === "tagFlowData") return;

					const content = await this.app.vault.read(file);
					const newTags = new Set(
						content.match(/#([a-zA-Z0-9_-]+)/g)
					);

					// Check if any tag has been changed
					const oldTags = this.tagCache.get(file.path);
					this.tagChanged = false;
					const obsoleteTags: string[] = [];
					if (oldTags) {
						// iterate through the tags in the tag cache for the currently modified file
						for (const oldTag of oldTags) {
							if (!newTags.has(oldTag)) {
								// if the new tags that are matches through regex don't contain the old tag of the cache, then add them to the obsolete array as they are no longer needed
								this.tagChanged = true;
								obsoleteTags.push(oldTag);
								break;
							}
						}
					}
					console.log({ newTags, oldTags });

					if (this.tagChanged) {
						console.log("tag changed");
						// set the new tags in the tag cache to update it
						this.tagCache.set(file.path, new Set(newTags));
						// find the old tags from the tagList[] that have now been modified
						const deletionList = this.lists
							.map((list) => {
								// check the obsolete list to see if the tag is there
								return obsoleteTags.includes(list.tag)
									? list
									: null;
							})
							// .filer(Boolean) will filter the null values. "as" keyword will cast the type as TagList[]
							.filter(Boolean) as TagList[];
						// delete the list that was made with the obsolete tag
						console.log("deleting lists");

						deletionList.forEach((list) =>
							this.deleteList(list, file, content)
						);
					}
				}
				if (this.hasSelectedTag) {
					this.updateLists();
				}
			})
		);

		setInterval(() => {
			this.updateLists();
		}, 60 * 60 * 1000);

		// this.app.workspace.onLayoutReady(async () => {
		// 	await this.loadData();
		// });

		// this.updateLists();
	}

	async deleteList(
		list: TagList,
		note: TFile | undefined,
		content: string | undefined
	) {
		// If no file content has been passed as argument then read the file and get the file content
		if (!content || !note) {
			note = this.app.vault.getAbstractFileByPath(list.notePath) as TFile;
			content = await this.app.vault.read(note);
		}
		const startAnchor = `<!--tag-list ${list.tag} ${list.id}-->`;
		const endAnchor = `<!--end-tag-list ${list.tag} ${list.id}-->`;
		const startIndex = content.indexOf(startAnchor);
		const endIndex = content.indexOf(endAnchor);
		if (startIndex >= 0) {
			if (endIndex >= 0) {
				// If the end anchor exists, delete the content between start and end anchors
				content =
					content.substring(0, startIndex) +
					content.substring(endIndex + endAnchor.length);
			} else {
				// If the end anchor does not exist, only delete the content from start anchor to the next line
				const nextLineIndex = content.indexOf("\n", startIndex);
				content =
					content.substring(0, startIndex) +
					content.substring(nextLineIndex + 1);
			}
			await this.app.vault.modify(note, content);

			// Remove the list from the plugin's lists
			this.lists = this.lists.filter((l) => l !== list);

			// Save the data
			await this.saveData();
		}
	}

	async fetchAllTags() {
		const allTags = new Set<string>();
		let match: RegExpExecArray | null;

		for (const file of this.app.vault.getMarkdownFiles()) {
			const fileContent = await this.app.vault.cachedRead(file);
			const tagRegex = /#([a-zA-Z0-9_-]+)/g;
			while ((match = tagRegex.exec(fileContent))) {
				allTags.add(match[1]);
			}
		}
		return Array.from(allTags);
	}

	async createTagList() {
		this.allTags = await this.fetchAllTags();
		if (this.allTags.length > 0) {
			console.log("yes tags");
			new TagSuggester(this.app, this, this.allTags).open();
		}
	}

	async handleTagSelection(tag: string) {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			const activeEditor = activeView.editor;
			const cursor = activeEditor.getCursor();
			const id = Date.now();
			activeEditor.replaceRange(
				`<!--tag-list #${tag} ${id}-->\n<!--end-tag-list #${tag} ${id}-->\n`,
				cursor
			);

			this.lists.push({
				tag: `#${tag}`,
				notePath: activeView.file.path,
				id: id,
			});
			this.hasSelectedTag = true;
			// await this.updateLists();
			await this.saveData();
		}
	}

	// async handleFileChange(file: TFile) {
	// 	// const file = this.app.workspace.getActiveFile();
	// 	// if (file instanceof TFile) {
	// 	// this.allTags = await this.fetchAllTags();
	// 	const content = await this.app.vault.read(file);
	// 	if (content.includes("<!--tag-list")) {
	// 		console.log("gonna update the list lmao");
	// 		await this.updateLists();
	// 	}
	// }

	async updateLists() {
		console.log("update list");
		if (!this.lists.length) {
			console.log("no lists");
			return;
		}

		//TODO: check this line
		this.hasSelectedTag = false;

		// get all the markdown files in the vault.
		const markdownFiles = this.app.vault.getMarkdownFiles();
		for (const list of this.lists) {
			// Use the tag cache to find the files that contain the tag from tag list
			const filesWithTag = markdownFiles.filter((file) => {
				const tags = this.tagCache.get(file.path);
				return tags && tags.has(list.tag);
			});

			const links = filesWithTag
				.map((file) => `[[${file.basename}]]`)
				.join("\n");

			const note = this.app.vault.getAbstractFileByPath(
				list.notePath
			) as TFile;
			let content = await this.app.vault.read(note);
			const startAnchor = `<!--tag-list ${list.tag} ${list.id}-->`;
			const endAnchor = `<!--end-tag-list ${list.tag} ${list.id}-->`;
			const startIndex = content.indexOf(startAnchor);
			const endIndex = content.indexOf(endAnchor);
			if (startIndex >= 0) {
				if (endIndex >= 0) {
					// If the end anchor exists, replace the content between start and end anchors
					content =
						content.substring(0, startIndex) +
						startAnchor +
						"\n" +
						links +
						"\n" +
						endAnchor +
						content.substring(endIndex + endAnchor.length);
				} else {
					// If the end anchor does not exist, insert it after the list
					content =
						content.substring(0, startIndex) +
						startAnchor +
						"\n" +
						links +
						"\n" +
						endAnchor +
						content.substring(startIndex + startAnchor.length);
				}

				await this.app.vault.modify(note, content);
			}
		}
	}

	async saveData() {
		const data = {
			lists: this.lists.map((list) => ({
				tag: list.tag,
				notePath: list.notePath,
				id: list.id,
			})),
		};
		await this.app.vault.adapter.write(
			"tagFlowData.json",
			JSON.stringify(data),
			{ ctime: Date.now() }
		);
	}

	async loadData() {
		try {
			console.log("loading data");

			const content = await this.app.vault.adapter.read(
				"tagFlowData.json"
			);
			const data = JSON.parse(content);

			this.lists = data.lists;
			this.addToCache();
		} catch (error) {
			console.error("Failed to load data:", error);
		}
	}

	async addToCache() {
		const tagMap = new Map<string, Set<string>>();

		await Promise.all(
			this.app.vault.getMarkdownFiles().map(async (file) => {
				const content = await this.app.vault.read(file);
				const matches = content.match(/#([a-zA-Z0-9_-]+)/g);

				const notePath = file.path;
				tagMap.set(notePath, new Set(matches));
			})
		);
		this.tagCache = tagMap;
	}

	onunload() {
		console.log("unloading plugin");
	}
}
