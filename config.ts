import { LocalAuthProvider, defineConfig } from 'tinacms';

export default defineConfig({
    contentApiUrlOverride: typeof window === 'undefined' ? 'http://localhost:3000/api/tina/graphql' : '/api/tina/graphql',
    branch: "dev",
    clientId: "local",
    token: "local",
    build: {
        outputFolder: "admin",
        publicFolder: "static",
    },
    media: {
        loadCustomStore: async () => {
            const { CustomMediaStore } = await import("./media-store");
            return CustomMediaStore;
        },
    },
    authProvider: new (class extends LocalAuthProvider {
        async logout() {
            window.location.assign('/logout');
        }
    })(),
    schema: {
        collections: [
            {
                name: "docs",
                label: "Docs",
                path: "docs",
                format: "md",
                fields: [
                    {
                        type: "string",
                        name: "title",
                        label: "Title",
                        isTitle: true,
                        required: true,
                    },
                    {
                        type: "string",
                        name: "description",
                        label: "Description",
                    },
                    {
                        type: "string",
                        name: "authors",
                        label: "Authors",
                        list: true,
                    },
                    {
                        type: "datetime",
                        name: "date",
                        label: "Date Created",
                    },
                    {
                        type: "object",
                        name: "last_update",
                        label: "Last Update",
                        fields: [
                            {
                                type: "datetime",
                                name: "date",
                                label: "Date",
                            },
                            {
                                type: "string",
                                name: "author",
                                label: "Author",
                            }
                        ]
                    },
                    {
                        type: "rich-text",
                        name: "body",
                        label: "Body",
                        isBody: true,
                    },
                ],
            },
            {
                name: "blog",
                label: "Blog",
                path: "blog",
                format: "md",
                fields: [
                    {
                        type: "string",
                        name: "title",
                        label: "Title",
                        isTitle: true,
                        required: true,
                    },
                    {
                        type: "string",
                        name: "authors",
                        label: "Authors",
                        list: true,
                    },
                    {
                        type: "datetime",
                        name: "date",
                        label: "Date",
                    },
                    {
                        type: "rich-text",
                        name: "body",
                        label: "Body",
                        isBody: true,
                    },
                ],
            },
        ],
    },
});
