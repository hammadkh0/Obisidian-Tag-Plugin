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

	async filterContent(file: TFile) {
		const content = await this.app.vault.read(file);
		// Define a regular expression pattern to match the anchor tags
		const anchorTagPattern =
			/<!--tag-list\s[^>]+-->[\s\S]*?<!--end-tag-list\s[^>]+-->/g;
		// Remove all anchor tags using the replace() method with the pattern
		const cleanedContent = content.replace(anchorTagPattern, "");
		return cleanedContent;
	}

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
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				console.log("new file created in the vault ");
				this.addToCache();
			})
		);
		// Update the cache whenever a file is modified
		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (!(file instanceof TFile)) {
					return;
				}
				if (file.basename === "tagFlowData") return;

				const cleanedContent = await this.filterContent(file);

				const newTags = new Set(
					cleanedContent.match(/#([a-zA-Z0-9_-]+)/g)
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
				console.log({ lists: this.lists });

				console.log({ obsoleteTags });

				if (this.tagChanged) {
					console.log("tag changed");
					// set the new tags in the tag cache to update it
					this.tagCache.set(file.path, new Set(newTags));

					// TODO: Check If deletion is good or udpate
					// !delete the list that was made with the obsolete tag
					// find the old tags from the tagList[] that have now been modified
					// const deletionList = this.lists
					// 	.map((list) => {
					// 		// check the obsolete list to see if the tag is there
					// 		return obsoleteTags.includes(list.tag)
					// 			? list
					// 			: null;
					// 	})
					// 	// .filer(Boolean) will filter the null values. "as" keyword will cast the type as TagList[]
					// 	.filter(Boolean) as TagList[];

					// console.log("deleting lists");
					// console.log({ deletionList });

					// deletionList.forEach((list) =>
					// 	this.deleteList(list, file, cleanedContent)
					// );
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

			if (links.length > 0 && extractedContent.includes(links)) {
				// the hyperlinks for tags inside the anchors are not modified so dont modify them
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
		note: TFile
	) {
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
			// ! Check modify vs process
			await this.app.vault.modify(note, content);
		}
	}

	async updateLists() {
		console.log("update list");
		if (!this.lists.length) {
			console.log("no lists");
			return;
		}
		this.hasSelectedTag = false;

		// get all the markdown files in the vault.
		const markdownFiles = this.app.vault.getMarkdownFiles();

		for (const list of this.lists) {
			// Use the tag cache to find the files that contain the tag from tag list
			const filesWithTag = markdownFiles.filter((file) => {
				const tags = this.tagCache.get(file.path);
				return tags && tags.has(list.tag);
			});
			console.log({ filesWithTag });

			/**
			 * Find all the file names that contain the current tag being iterated
			 * For example: IF files like A.md and B.md contain the tag #apple, then both fileNames will be added to the links string
			 * The names will be added in [[fileName]] format to create hyperlink to take to that file
			 * */
			const links = filesWithTag
				.map((file) => `[[${file.basename}]]`)
				.join("\n");

			// Get the currently opened file as activeLeaf
			const activeLeaf = this.app.workspace.activeLeaf?.view;
			// If activeLeaf is not a MarkdownView then return it;
			if (!(activeLeaf instanceof MarkdownView)) {
				return;
			}
			const file = activeLeaf.file;
			// Read the contents of the currently opened file
			const content = await this.app.vault.read(file);
			// Get the anchor tags & the index for the currently iterated list
			const startAnchor = `<!--tag-list ${list.tag} ${list.id}-->`;
			const endAnchor = `<!--end-tag-list ${list.tag} ${list.id}-->`;
			const startIndex = content.indexOf(startAnchor);
			const endIndex = content.indexOf(endAnchor);

			// * check if the links are same as the links between anchor tags
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
				file
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

		await Promise.all(
			this.app.vault.getMarkdownFiles().map(async (file) => {
				const cleanedContent = await this.filterContent(file);
				const matches = cleanedContent.match(/#([a-zA-Z0-9_-]+)/g);

				const notePath = file.path;
				tagMap.set(notePath, new Set(matches));
			})
		);

		this.tagCache = tagMap;
		console.log(this.tagCache);
	}

	onunload() {
		console.log("unloading plugin");
	}
}
