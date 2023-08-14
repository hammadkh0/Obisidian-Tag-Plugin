import DeleteListModal from "modals/DeleteListModal";
import TagSuggester from "modals/TagSuggester";
import { Plugin, MarkdownView, TFile, Notice } from "obsidian";

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

	async filterContent(file: TFile) {
		const content = await this.app.vault.read(file);
		// Define a regular expression pattern to match the anchor tags
		const anchorTagPattern =
			/<!--tag-list\s[^>]+-->[\s\S]*?<!--end-tag-list\s[^>]+-->/g;
		// Remove all anchor tags using the replace() method with the pattern
		const cleanedContent = content.replace(anchorTagPattern, "");
		return cleanedContent;
	}
	getFrontmatterTags(file: TFile) {
		let newTags: Set<string>;
		const cache = this.app.metadataCache.getFileCache(file);
		if (cache && cache.frontmatter) {
			// Your code here
			console.log("Updated Frontmatter: ", cache.frontmatter);
			console.log("Cache file tags: ", cache.tags);

			const frontMatterTags: string = cache.frontmatter.tags;
			const frontmatterTagsArr = frontMatterTags
				.split(",")
				.map((tag) => {
					tag = tag.trim();
					if (tag !== "") return "#" + tag;
				})
				.filter(Boolean) as string[];

			console.log({ frontMatterTags });
			newTags = new Set(frontmatterTagsArr);
			console.log("After frontmater tags added to cache, ", newTags);
		}
		return newTags;
	}
	async onload() {
		console.log("Plugin loaded");

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
			// console.log("active-leaf-change");
			// this.updateLists();
		});
		// this.app.workspace.on("file-open", (file) => {
		// 	if (file) {
		// 		for (const item of this.getFrontmatterTags(file)) {
		// 			this.tagCache.get(file.path)?.add(item);
		// 		}
		// 	}
		// });
		this.app.workspace.on("layout-change", () => {
			if (this.app.workspace.getLeavesOfType("graph").length > 0) {
				console.log("layout-change");
				this.updateLists();
			}
		});
		this.app.workspace.onLayoutReady(async () => {});

		this.registerEvent(
			this.app.metadataCache.on("resolved", async () => {
				await this.loadData();
				this.allTags = await this.fetchAllTags();
			})
		);

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				console.log("new file created in the vault ");
				this.tagCache.set(file.path, new Set());
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (!(file instanceof TFile)) return;
				// oldPath = the previous path of the file
				// file, the new file data i.e the new name of file alongwith other properties
				console.log("RENAME EVENT", file.basename, file.path, oldPath);

				const data = this.tagCache.get(oldPath) as Set<string>;
				this.tagCache.delete(oldPath);
				this.tagCache.set(file.path, data);

				// overwrite the file's notepath with the new path
				this.lists = this.lists.map((tagList) => {
					if (tagList.notePath === oldPath) {
						tagList.notePath = file.path;
					}
					return tagList;
				});

				console.log("TagLists on renaming: ", this.lists);
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", async (file) => {
				if (!(file instanceof TFile)) {
					return;
				}
				console.log("File Deleted: ", file.name, file.path);
				this.lists = this.lists
					.map((tagList) => {
						if (tagList.notePath !== file.path) {
							return tagList;
						}
					})
					.filter(Boolean) as TagList[];

				if (this.tagCache.has(file.path)) {
					console.log("tagCache has this file", file.path);

					this.tagCache.delete(file.path);
				}
				await this.saveData();
			})
		);
		// Update the cache whenever a file is modified
		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (!(file instanceof TFile)) {
					return;
				}
				if (file.basename === "tagFlowData") return;

				let newTags;
				const cache = this.app.metadataCache.getFileCache(file);
				if (cache) {
					const tags = cache.tags?.map((tag) => tag.tag);
					newTags = new Set(tags);
				} else {
					const cleanedContent = await this.filterContent(file);
					newTags = new Set(
						cleanedContent.match(/#([a-zA-Z0-9_-]+)/g)
					);
				}
				for (const item of this.getFrontmatterTags(file)) {
					newTags.add(item);
				}
				// Check if any tag has been changed
				const oldTags = this.tagCache.get(file.path);
				this.tagChanged = false;

				if (oldTags) {
					// iterate through the tags in the tag cache for the currently modified file
					for (const newTag of newTags) {
						if (!oldTags.has(newTag)) {
							this.tagChanged = true;
							break;
						}
					}
				}
				console.log({ newTags, oldTags });
				console.log({ lists: this.lists });
				console.log({ tagCache: this.tagCache });

				this.tagCache.set(file.path, new Set(newTags));
				if (this.tagChanged) {
					console.log("tag changed");
					this.updateLists();
				}
				if (this.hasSelectedTag) {
					this.updateLists();
				}
			})
		);

		setInterval(() => {
			this.updateLists();
		}, 60 * 60 * 1000);
	}

	async deleteList(
		list: TagList,
		note: TFile | null,
		content: string | null
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

			// Remove the list from the plugin's lists
			this.lists = this.lists.filter((l) => l !== list);
			// Save the data
			await this.saveData();
			// Update the file
			await this.app.vault.modify(note, content);
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
			await this.saveData();
		}
	}

	alreadyExistingHyperlinks(
		startIndex: number,
		endIndex: number,
		content: string,
		startAnchor: string,
		links: string
	) {
		if (startIndex !== -1 && endIndex !== -1) {
			// Extract the content between startAnchor and endAnchor
			const extractedContent = content.substring(
				startIndex + startAnchor.length,
				endIndex
			);
			console.log({ extractedContent }, { markdownLinks: links });

			if (links.length > 0 && extractedContent === links) {
				// the hyperlinks for tags inside the anchors are not modified so dont modify them again
				console.log("Existing tags found for the tag: " + links);

				return true;
			}
		}
		return false;
	}
	async replaceAnchorContents(
		startIndex: number,
		endIndex: number,
		content: string,
		startAnchor: string,
		endAnchor: string,
		links: string,
		note: TFile,
		list: TagList
	) {
		links = links.trim();
		if (startIndex >= 0 && links.length > 0) {
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
			// ! Check modify vs process
			await this.app.vault.modify(note, content);
		} else {
			//Remove the Tags and modify content
			this.deleteList(list, note, content);
		}
	}

	async updateLists() {
		console.log("update list");

		if (!this.lists.length) {
			console.log("no lists");
			return;
		}
		this.hasSelectedTag = false;

		const markdownFiles = this.app.vault.getMarkdownFiles();
		// Get the currently opened file as activeLeaf
		const activeLeaf = this.app.workspace.activeLeaf?.view;
		if (!(activeLeaf instanceof MarkdownView)) {
			return;
		}
		const file = activeLeaf.file;

		// filtering out those tag-lists from this.lists that are only present in the currently opened file
		const extractedLists = this.lists.filter(
			(list) => list.notePath === file.path
		);

		for (const list of extractedLists) {
			// Use the tag cache to find the files that contain the tag from tag list
			const filesWithTag = markdownFiles.filter((file) => {
				const tags = this.tagCache.get(file.path);
				return tags && tags.has(list.tag);
			});
			console.log({ filesWithTag });

			const links = filesWithTag
				.map((file) => `[[${file.basename}]]`)
				.join("\n");

			// * Read the contents of the currently opened file
			const content = await this.app.vault.read(file);
			// * Get the anchor tags & the index for the currently iterated list
			const startAnchor = `<!--tag-list ${list.tag} ${list.id}-->`;
			const endAnchor = `<!--end-tag-list ${list.tag} ${list.id}-->`;
			const startIndex = content.indexOf(startAnchor);
			const endIndex = content.indexOf(endAnchor);

			// * Check if the links are same as the links between anchor tags
			const existingHyperlinks = this.alreadyExistingHyperlinks(
				startIndex,
				endIndex,
				content,
				startAnchor,
				links
			);
			if (existingHyperlinks) {
				continue;
			}
			console.log("gonna replace the tags");

			await this.replaceAnchorContents(
				startIndex,
				endIndex,
				content,
				startAnchor,
				endAnchor,
				links,
				file,
				list
			);
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
		let newTags: Set<string>;
		this.app.vault.getMarkdownFiles().map((file) => {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache) {
				const tags = cache.tags?.map((tag) => tag.tag);
				newTags = new Set(tags);
			}
			const frontmatterTags = this.getFrontmatterTags(file);

			console.log(
				"🚀 ~ file: main.ts:460 ~ TagFlowPlugin ~ this.app.vault.getMarkdownFiles ~ frontmatterTags:",
				frontmatterTags
			);
			const notePath = file.path;

			// Combine matchesSet and frontMatterTags into a single Set
			let combinedTags;
			if (frontmatterTags !== undefined) {
				combinedTags = new Set([...newTags, ...frontmatterTags]);
			} else {
				combinedTags = new Set([...newTags]);
			}
			tagMap.set(notePath, new Set(combinedTags));
		});

		this.tagCache = tagMap;
		console.log(this.tagCache);
	}

	onunload() {
		console.log("unloading plugin");
	}
}
