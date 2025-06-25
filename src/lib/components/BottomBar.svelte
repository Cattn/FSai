<script lang="ts">
    import { Button } from "m3-svelte";
</script>

<div class="fixed bottom-4 py-3 left-60 right-60 rounded-full bg-primary">
    <div class="w-1/2 mx-auto flex justify-between items-center space-x-2">
        <input 
            type="text" 
            placeholder="Do something..."
            class="bg-primary-container rounded-3xl py-3 w-11/12 text-on-surface-variant text-center focus:outline-none focus:ring-2 focus:ring-primary focus:ring-opacity-50 px-4"
        />
        <div class="rounded-3xl py-3 w-1/12">
            <Button variant="elevated" iconType="full">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" {...$$props}>
                    <path fill="currentColor" d="M4.4 19.425q-.5.2-.95-.088T3 18.5V14l8-2l-8-2V5.5q0-.55.45-.837t.95-.088l15.4 6.5q.625.275.625.925t-.625.925z" />
                </svg>
            </Button>
        </div>
    </div>
</div>